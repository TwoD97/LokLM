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
#include <vector>

#include <ctranslate2/translator.h>
#include <nlohmann/json.hpp>
#include <sentencepiece_processor.h>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

using json = nlohmann::json;

namespace {

void emitLine(const json& j) {
  std::cout << j.dump() << "\n" << std::flush;
}

struct Args {
  std::string modelDir;
  std::string spmPath;
  int threads = 0;  // 0 = let ctranslate2 pick
  int beam = 1;     // greedy by default — interactive latency beats +0.x BLEU
};

Args parseArgs(int argc, char** argv) {
  Args a;
  for (int i = 1; i < argc - 1; ++i) {
    const std::string flag = argv[i];
    if (flag == "--model") a.modelDir = argv[++i];
    else if (flag == "--spm") a.spmPath = argv[++i];
    else if (flag == "--threads") a.threads = std::atoi(argv[++i]);
    else if (flag == "--beam") a.beam = std::atoi(argv[++i]);
  }
  return a;
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

  std::unique_ptr<ctranslate2::Translator> translator;
  try {
    ctranslate2::models::ModelLoader loader(args.modelDir);
    loader.device = ctranslate2::Device::CPU;
    // DEFAULT keeps the on-disk int8 weights as-is instead of widening.
    loader.compute_type = ctranslate2::ComputeType::DEFAULT;
    ctranslate2::ReplicaPoolConfig pool;
    pool.num_threads_per_replica = static_cast<size_t>(args.threads);
    translator = std::make_unique<ctranslate2::Translator>(loader, pool);
  } catch (const std::exception& e) {
    emitLine({{"ev", "fatal"}, {"error", std::string("failed to load model: ") + e.what()}});
    return 1;
  }

  emitLine({{"ev", "ready"}, {"model", args.modelDir}});

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
