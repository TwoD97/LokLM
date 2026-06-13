// loklm-translator — stdio NDJSON sidecar around CTranslate2 + SentencePiece
// running MADLAD-400-3B-MT (T5 seq2seq , `<2xx>` target-token protocol).
//
// Protocol: one JSON object per line on stdin , one per line on stdout.
//   → {"id":1,"op":"translate","texts":["…","…"],"target":"de","beam":1}
//   ← {"id":1,"ok":true,"results":["…","…"]}
//   → {"id":2,"op":"ping"}      ← {"id":2,"ok":true}
//   → {"id":3,"op":"shutdown"}  ← {"id":3,"ok":true} , then exit 0
// Startup handshake , emitted once before any request is answered:
//   ← {"ev":"ready","model":"<dir>"}
// Fatal startup errors: {"ev":"fatal","error":"…"} on stdout , exit 1.
// stderr is free-form log text and never carries protocol frames.
//
// The process exits when stdin closes — the parent dying must not leave a
// 3 GB model resident as an orphan (see ModelsWorkerClient for the same
// policy on the llama worker).

#include <cstdio>
#include <cstdlib>
#include <iostream>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include <ctranslate2/devices.h>
#include <ctranslate2/translator.h>
#include <nlohmann/json.hpp>
#include <sentencepiece_processor.h>

#ifdef LOKLM_WITH_CUDA
#include <cuda_runtime.h>
#endif

#if defined(_WIN32)
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX  // keep std::min/std::max usable — windows.h defines macros otherwise
#include <fcntl.h>
#include <io.h>
#include <windows.h>
#elif defined(__APPLE__)
#include <sys/sysctl.h>
#elif defined(__linux__)
#include <fstream>
#include <set>
#include <utility>
#endif

using json = nlohmann::json;

namespace {

void emitLine(const json& j) {
  std::cout << j.dump() << "\n" << std::flush;
}

struct Args {
  std::string modelDir;
  std::string spmPath;
  int threads = 0;             // 0 = auto (physical cores — see resolveThreads)
  int beam = 1;                // greedy by default — interactive latency beats +0.x BLEU
  std::string device = "auto"; // auto | cpu | cuda ; 'auto' = GPU iff enough free VRAM
};

// Model needs ~3 GB on the GPU (int8 3B weights + activation/cache buffers).
// In 'auto' we only place on GPU when at least this much VRAM is free , so a
// small/busy card cleanly falls back to CPU instead of OOM-ing mid-load.
constexpr size_t MIN_FREE_VRAM_BYTES = 4ULL * 1024 * 1024 * 1024;

// Physical core count , or 0 if it can't be determined. CTranslate2's int8
// GEMM is memory-bandwidth-bound , so threading PAST physical cores (i.e. onto
// hyperthreads) hurts — measured on an 8C/16T box: 8 threads = 4.4s , 16 = 10.4s
// for the same batch. So we want physical , not logical.
size_t physicalCoreCount() {
#if defined(_WIN32)
  DWORD len = 0;
  GetLogicalProcessorInformationEx(RelationProcessorCore, nullptr, &len);
  if (len == 0) return 0;
  std::vector<char> buf(len);
  if (!GetLogicalProcessorInformationEx(RelationProcessorCore,
                                        reinterpret_cast<PSYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX>(
                                            buf.data()),
                                        &len))
    return 0;
  size_t cores = 0;
  for (DWORD off = 0; off < len;) {
    auto* info = reinterpret_cast<PSYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX>(buf.data() + off);
    if (info->Relationship == RelationProcessorCore) ++cores;
    off += info->Size;
  }
  return cores;
#elif defined(__APPLE__)
  int n = 0;
  size_t sz = sizeof(n);
  if (sysctlbyname("hw.physicalcpu", &n, &sz, nullptr, 0) == 0 && n > 0)
    return static_cast<size_t>(n);
  return 0;
#elif defined(__linux__)
  // Count distinct (physical id , core id) pairs in /proc/cpuinfo — that's
  // physical cores across all sockets , excluding SMT siblings.
  std::ifstream f("/proc/cpuinfo");
  if (!f) return 0;
  std::set<std::pair<int, int>> cores;
  std::string line;
  int physId = 0, coreId = -1;
  bool haveCore = false;
  while (std::getline(f, line)) {
    if (line.rfind("physical id", 0) == 0) {
      physId = std::atoi(line.c_str() + line.find(':') + 1);
    } else if (line.rfind("core id", 0) == 0) {
      coreId = std::atoi(line.c_str() + line.find(':') + 1);
      haveCore = true;
    } else if (line.empty() && haveCore) {
      cores.insert({physId, coreId});
      haveCore = false;
      coreId = -1;
    }
  }
  if (haveCore) cores.insert({physId, coreId});
  return cores.size();
#else
  return 0;
#endif
}

// CTranslate2's own default (utils.cc get_default_num_threads) caps intra-op
// parallelism at min(4, hw) when num_threads_per_replica==0 — and with OpenMP
// disabled (our build) there's no OMP_NUM_THREADS to lift it. We instead target
// PHYSICAL cores: more than that lands on hyperthreads and slows the GEMM down
// (see physicalCoreCount). --threads overrides for tuning.
size_t resolveThreads(int requested) {
  if (requested > 0) return static_cast<size_t>(requested);
  const size_t phys = physicalCoreCount();
  if (phys > 0) return phys;
  // Couldn't detect — assume SMT on anything wider than 4 logical and halve.
  const unsigned int hw = std::thread::hardware_concurrency();
  if (hw == 0) return 4;
  return hw > 4 ? hw / 2 : hw;
}

Args parseArgs(int argc, char** argv) {
  Args a;
  for (int i = 1; i < argc - 1; ++i) {
    const std::string flag = argv[i];
    if (flag == "--model") a.modelDir = argv[++i];
    else if (flag == "--spm") a.spmPath = argv[++i];
    else if (flag == "--threads") a.threads = std::atoi(argv[++i]);
    else if (flag == "--beam") a.beam = std::atoi(argv[++i]);
    else if (flag == "--device") a.device = argv[++i];
  }
  return a;
}

std::string gib(size_t bytes) {
  char buf[32];
  std::snprintf(buf, sizeof(buf), "%.1f", static_cast<double>(bytes) / (1024.0 * 1024 * 1024));
  return buf;
}

struct DevicePick {
  ctranslate2::Device device;
  std::string note;  // human-readable reason , logged to stderr + sent in `ready`
};

// Decide CPU vs GPU. 'auto' places on CUDA only when a device exists AND has
// enough free VRAM for the model , else CPU — so a missing/small/busy GPU
// degrades cleanly instead of failing the load. A cpu-only build (no
// LOKLM_WITH_CUDA) is always CPU; 'cuda' there is honoured as 'cpu' with a note.
DevicePick resolveDevice(const std::string& choice) {
  using ctranslate2::Device;
  if (choice == "cpu") return {Device::CPU, "cpu (forced)"};
#ifdef LOKLM_WITH_CUDA
  int gpus = 0;
  try {
    gpus = ctranslate2::get_device_count(Device::CUDA);
  } catch (...) {
    gpus = 0;  // no driver / runtime → treat as no GPU
  }
  if (gpus <= 0) return {Device::CPU, "no CUDA device — using cpu"};
  if (choice == "cuda") return {Device::CUDA, "cuda (forced)"};
  // auto
  size_t freeB = 0, totalB = 0;
  if (cudaMemGetInfo(&freeB, &totalB) == cudaSuccess && freeB >= MIN_FREE_VRAM_BYTES)
    return {Device::CUDA, "cuda (" + gib(freeB) + " GiB VRAM free)"};
  return {Device::CPU, "GPU VRAM below " + gib(MIN_FREE_VRAM_BYTES) + " GiB free — using cpu"};
#else
  if (choice == "cuda") return {Device::CPU, "cuda requested but this is a cpu-only build"};
  return {Device::CPU, "cpu"};
#endif
}

// A target is valid iff its `<2xx>` token exists in the vocabulary — an
// unknown token would tokenize into junk pieces and the model would happily
// "translate" into garbage instead of failing. Checked via PieceToId , NOT by
// encoding: Encode("<2en>") yields ['▁','<2en>'] (dummy-prefix piece) , so a
// piece-count heuristic rejects valid languages.
bool isKnownTarget(sentencepiece::SentencePieceProcessor& sp, const std::string& target) {
  if (target.empty() || target.size() > 16) return false;
  const int id = sp.PieceToId(std::string("<2" + target + ">"));
  return id != sp.unk_id();
}

}  // namespace

int main(int argc, char** argv) {
#ifdef _WIN32
  // Keep \n as-is in both directions — the framing is byte-oriented and CRLF
  // translation would inject \r into frames (and break getline on input).
  _setmode(_fileno(stdout), _O_BINARY);
  _setmode(_fileno(stdin), _O_BINARY);
#endif

  const Args args = parseArgs(argc, argv);
  if (args.modelDir.empty()) {
    emitLine({{"ev", "fatal"}, {"error", "--model <dir> is required"}});
    return 1;
  }
  const std::string spmPath =
      args.spmPath.empty() ? args.modelDir + "/sentencepiece.model" : args.spmPath;

  sentencepiece::SentencePieceProcessor sp;
  const auto spStatus = sp.Load(spmPath);
  if (!spStatus.ok()) {
    emitLine({{"ev", "fatal"},
              {"error", "failed to load sentencepiece model: " + spStatus.ToString()}});
    return 1;
  }

  const DevicePick pick = resolveDevice(args.device);
  const bool onCpu = pick.device == ctranslate2::Device::CPU;
  const size_t threads = resolveThreads(args.threads);

  std::unique_ptr<ctranslate2::Translator> translator;
  try {
    ctranslate2::models::ModelLoader loader(args.modelDir);
    loader.device = pick.device;
    // DEFAULT keeps the on-disk int8 weights as-is instead of widening.
    loader.compute_type = ctranslate2::ComputeType::DEFAULT;
    ctranslate2::ReplicaPoolConfig pool;
    // intra-op threads only matter on CPU; on GPU the GEMMs run on-device.
    if (onCpu) pool.num_threads_per_replica = threads;
    translator = std::make_unique<ctranslate2::Translator>(loader, pool);
    std::cerr << "[loklm-translator] device: " << pick.note;
    if (onCpu) std::cerr << " ; intra-op threads: " << threads;
    std::cerr << "\n";
  } catch (const std::exception& e) {
    emitLine({{"ev", "fatal"}, {"error", std::string("failed to load model: ") + e.what()}});
    return 1;
  }

  emitLine({{"ev", "ready"},
            {"model", args.modelDir},
            {"device", onCpu ? "cpu" : "cuda"},
            {"deviceNote", pick.note}});

  std::string line;
  while (std::getline(std::cin, line)) {
    if (!line.empty() && line.back() == '\r') line.pop_back();
    if (line.empty()) continue;

    json req;
    try {
      req = json::parse(line);
    } catch (const std::exception& e) {
      // Not a frame we understand — log and keep serving , a single corrupt
      // line must not wedge the request loop.
      std::cerr << "[loklm-translator] dropped unparseable line: " << e.what() << "\n";
      continue;
    }
    const long long id = req.value("id", -1LL);
    const std::string op = req.value("op", "");

    try {
      if (op == "ping") {
        emitLine({{"id", id}, {"ok", true}});
        continue;
      }
      if (op == "shutdown") {
        emitLine({{"id", id}, {"ok", true}});
        // _Exit , not return: the CTranslate2 replica-pool destructor can hang
        // joining worker threads and every clean smoke run left a zombie. The
        // only process state is read-only model memory — skip all teardown.
        std::_Exit(0);
      }
      if (op == "translate") {
        const std::string target = req.value("target", "");
        if (!isKnownTarget(sp, target))
          throw std::runtime_error("unsupported target language: '" + target + "'");
        const auto& texts = req.at("texts");
        if (!texts.is_array()) throw std::runtime_error("texts must be an array");

        std::vector<std::vector<std::string>> batch;
        batch.reserve(texts.size());
        for (const auto& t : texts) {
          std::vector<std::string> pieces;
          sp.Encode("<2" + target + "> " + t.get<std::string>(), &pieces);
          // T5 sources must end with EOS (the HF tokenizer appends it
          // implicitly , sp.Encode does not). Without it the decoder treats
          // the input as unfinished and rambles past the sentence.
          pieces.push_back("</s>");
          batch.push_back(std::move(pieces));
        }

        ctranslate2::TranslationOptions opts;
        opts.beam_size = static_cast<size_t>(std::max(1, req.value("beam", args.beam)));
        opts.max_decoding_length = 512;
        auto results = translator->translate_batch(batch, opts);

        json out = json::array();
        for (auto& r : results) {
          std::string text;
          sp.Decode(r.output(), &text);
          out.push_back(text);
        }
        emitLine({{"id", id}, {"ok", true}, {"results", out}});
        continue;
      }
      throw std::runtime_error("unknown op: '" + op + "'");
    } catch (const std::exception& e) {
      emitLine({{"id", id}, {"ok", false}, {"error", e.what()}});
    }
  }

  // stdin closed → parent is gone. Hard-exit instead of lingering as an
  // orphan (same destructor-hang rationale as the shutdown op above).
  std::_Exit(0);
}
