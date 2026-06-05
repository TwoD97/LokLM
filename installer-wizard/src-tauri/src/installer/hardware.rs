// Hardware probe + tier recommendation for the install wizard.
//
// Called once during the hardware-check page ( between license and
// options ). Output drives the tier picker's default selection ; user can
// always override.
//
// Probe sources :
//   GPU + VRAM    → wgpu::Instance::enumerate_adapters
//   GPU arch      → derived from adapter name ( substring match , see
//                   classify_gpu_arch ) — vendor/device IDs would be
//                   more precise but the maintenance burden ( PCI ID
//                   table per generation ) isn't worth it for a default
//                   that the user can override
//   RAM + CPU     → sysinfo
//
// Recommendation algorithm : memory-first ( hard constraint : does the
// model fit ) , chip-type as tie-breaker at boundaries ( quality signal :
// will inference be pleasant ). See plan-doc 2026-05-23-light-normal-pro-tiers.md
// for the budget rationale.

use serde::{Deserialize, Serialize};
use sysinfo::System;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HardwareProfile {
    pub gpu_name: Option<String>,
    pub gpu_vram_bytes: Option<u64>,
    pub gpu_arch: Option<GpuArch>,
    pub cpu_threads: u32,
    pub cpu_brand: String,
    pub ram_bytes: u64,
    pub recommended_tier: Tier,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Tier {
    // Renamed from Light → Lite , Normal → Standard on 2026-05-24 to match
    // the user-facing nomenclature settled after the Qwen3.5 eval-run
    // ( see plan-doc ). Pro keeps its name.
    Lite,
    Standard,
    Pro,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum GpuArch {
    NvidiaPascal,
    NvidiaTuring,
    NvidiaAmpere,
    NvidiaAda,
    NvidiaBlackwell,
    AmdRdna2,
    AmdRdna3,
    AmdRdna4,
    IntelArc,
    IntelIris,
    AppleM1,
    AppleM2,
    AppleM3,
    AppleM4,
    Other,
}

pub fn probe() -> HardwareProfile {
    let (gpu_name, gpu_vram_bytes, gpu_arch) = probe_gpu();

    let mut sys = System::new();
    sys.refresh_memory();
    sys.refresh_cpu_list(sysinfo::CpuRefreshKind::new());

    let ram_bytes = sys.total_memory();
    let cpu_threads = sys.cpus().len() as u32;
    let cpu_brand = sys
        .cpus()
        .first()
        .map(|c| c.brand().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    let mut profile = HardwareProfile {
        gpu_name,
        gpu_vram_bytes,
        gpu_arch,
        cpu_threads,
        cpu_brand,
        ram_bytes,
        recommended_tier: Tier::Lite,
    };
    profile.recommended_tier = recommend(&profile);
    profile
}

// --- GPU probe -----------------------------------------------------------

fn probe_gpu() -> (Option<String>, Option<u64>, Option<GpuArch>) {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::PRIMARY,
        ..Default::default()
    });

    let adapters = instance.enumerate_adapters(wgpu::Backends::PRIMARY);

    // Pick the discrete adapter if there is one ; otherwise the first
    // integrated/other adapter. CPU/software adapters are skipped — they
    // don't represent a usable GPU for our purposes.
    let chosen = adapters
        .iter()
        .find(|a| matches!(a.get_info().device_type, wgpu::DeviceType::DiscreteGpu))
        .or_else(|| {
            adapters.iter().find(|a| {
                !matches!(
                    a.get_info().device_type,
                    wgpu::DeviceType::Cpu | wgpu::DeviceType::Other
                )
            })
        });

    let Some(adapter) = chosen else {
        return (None, None, None);
    };

    let info = adapter.get_info();
    let name = info.name.clone();
    let arch = classify_gpu_arch(&name);

    // VRAM: wgpu's adapter.limits().max_buffer_size is a per-allocation API
    // limit , not real VRAM. On DX12 ( Windows default ) it reports u64::MAX
    // / huge sentinels for every modern card — the 80-GiB clamp then masks
    // every Windows GPU as "80 GiB" → users landed in Pro by memory alone
    // regardless of vendor. Vendor-specific paths :
    //   NVIDIA          → NVML ( Win + Linux )
    //   AMD / Intel Win → DXGI IDXGIAdapter1::DedicatedVideoMemory
    //   else            → wgpu estimate with the 80-GiB clamp ( still
    //                     inaccurate ; user can override on the picker )
    let is_nvidia = matches!(
        arch,
        GpuArch::NvidiaPascal
            | GpuArch::NvidiaTuring
            | GpuArch::NvidiaAmpere
            | GpuArch::NvidiaAda
            | GpuArch::NvidiaBlackwell,
    );
    let vram_bytes = if is_nvidia {
        probe_nvidia_vram_nvml(&name).unwrap_or_else(|| vram_from_wgpu(adapter))
    } else {
        non_nvidia_vram(adapter, &info)
    };

    (Some(name), Some(vram_bytes), Some(arch))
}

// NVML read for NVIDIA cards. Returns the matching device's total memory ,
// or the largest NVIDIA device's memory if name match fails ( e.g. NVML's
// canonical name differs slightly from wgpu's ) , or None if NVML isn't
// installed / fails to init ( non-NVIDIA system , broken driver ).
fn probe_nvidia_vram_nvml(target_name: &str) -> Option<u64> {
    let nvml = nvml_wrapper::Nvml::init().ok()?;
    let count = nvml.device_count().ok()?;
    if count == 0 {
        return None;
    }

    let target_lower = target_name.to_ascii_lowercase();
    let mut largest: Option<u64> = None;

    for i in 0..count {
        let Ok(dev) = nvml.device_by_index(i) else { continue };
        let Ok(mem) = dev.memory_info() else { continue };
        if let Ok(name) = dev.name() {
            if name.to_ascii_lowercase() == target_lower {
                return Some(mem.total);
            }
        }
        if largest.map_or(true, |b| mem.total > b) {
            largest = Some(mem.total);
        }
    }

    largest
}

// Fallback path for non-NVIDIA adapters. Same logic the file used to apply
// unconditionally — keep the 80-GiB clamp so DX12's u64::MAX sentinel ( and
// equivalents on other backends ) still serialize and still trigger the Pro
// memory threshold ; user can override.
fn vram_from_wgpu(adapter: &wgpu::Adapter) -> u64 {
    const MAX_REASONABLE_VRAM: u64 = 80 * GB;
    adapter.limits().max_buffer_size.min(MAX_REASONABLE_VRAM)
}

// Non-NVIDIA VRAM read. On Windows we ask DXGI by vendor/device ID — the
// kernel driver reports real DedicatedVideoMemory ( e.g. 7900 XTX = ~25 GB ,
// 760M iGPU = ~512 MB UEFI carve-out ). Elsewhere we fall back to wgpu.
fn non_nvidia_vram(adapter: &wgpu::Adapter, info: &wgpu::AdapterInfo) -> u64 {
    #[cfg(target_os = "windows")]
    if let Some(v) = probe_dxgi_vram(info.vendor, info.device) {
        return v;
    }
    let _ = info; // unused on non-Windows
    vram_from_wgpu(adapter)
}

#[cfg(target_os = "windows")]
fn probe_dxgi_vram(vendor_id: u32, device_id: u32) -> Option<u64> {
    use windows::Win32::Graphics::Dxgi::{
        CreateDXGIFactory1, IDXGIAdapter1, IDXGIFactory1, DXGI_ADAPTER_DESC1,
    };

    let mut adapters: Vec<(u32, u32, u64)> = Vec::new();
    unsafe {
        let factory: IDXGIFactory1 = CreateDXGIFactory1().ok()?;
        // EnumAdapters1 yields adapters until DXGI_ERROR_NOT_FOUND. Cap the
        // loop defensively in case a driver returns success on a phantom
        // index ( seen on a few Hyper-V configurations ).
        for idx in 0u32..32 {
            let Ok(adapter): windows::core::Result<IDXGIAdapter1> = factory.EnumAdapters1(idx)
            else {
                break;
            };
            let mut desc = DXGI_ADAPTER_DESC1::default();
            if adapter.GetDesc1(&mut desc).is_err() {
                continue;
            }
            adapters.push((desc.VendorId, desc.DeviceId, desc.DedicatedVideoMemory as u64));
        }
    }
    select_dxgi_vram(&adapters, vendor_id, device_id)
}

// Pick the dedicated-VRAM figure for the wgpu-chosen adapter out of the DXGI
// adapter list. Exact vendor+device match wins ( correct on multi-GPU boxes ).
//
// Fallback : if no exact match , take the largest dedicated VRAM among
// same-vendor adapters. wgpu's Vulkan backend ( the adapter we usually pick
// on Windows ) can report a `device` id that disagrees with DXGI's PCI
// DeviceId ; without this fallback the caller drops to vram_from_wgpu , whose
// max_buffer_size is the u64::MAX sentinel → clamped to 80 GiB. That sentinel
// masquerading as real VRAM is the recurring "AMD card shows 80 GB" bug , so
// we never let a real GPU slip through to it.
#[cfg(any(target_os = "windows", test))]
fn select_dxgi_vram(adapters: &[(u32, u32, u64)], vendor_id: u32, device_id: u32) -> Option<u64> {
    if let Some(&(_, _, mem)) = adapters
        .iter()
        .find(|&&(v, d, _)| v == vendor_id && d == device_id)
    {
        return Some(mem);
    }
    adapters
        .iter()
        .filter(|&&(v, _, _)| v == vendor_id)
        .map(|&(_, _, mem)| mem)
        .max()
        .filter(|&m| m > 0)
}

fn classify_gpu_arch(name: &str) -> GpuArch {
    let n = name.to_ascii_lowercase();

    // NVIDIA — generation lives in the model number ( RTX 5xxx = Blackwell ,
    // RTX 4xxx = Ada , RTX 3xxx = Ampere , RTX 2xxx + GTX 16xx = Turing ,
    // GTX 10xx = Pascal ). We also tag the Ax000/Hx00 workstation/server
    // SKUs at the same generation boundaries.
    if n.contains("nvidia") || n.contains("geforce") || n.contains("rtx") || n.contains("gtx") {
        if n.contains("rtx 50") || n.contains("rtx5") || n.contains("b100") || n.contains("b200") {
            return GpuArch::NvidiaBlackwell;
        }
        if n.contains("rtx 40") || n.contains("rtx4") || n.contains("l40") || n.contains("l4 ") {
            return GpuArch::NvidiaAda;
        }
        if n.contains("rtx 30") || n.contains("rtx3") || n.contains("a100") || n.contains("a40") {
            return GpuArch::NvidiaAmpere;
        }
        if n.contains("rtx 20") || n.contains("rtx2") || n.contains("gtx 16") || n.contains("t4") {
            return GpuArch::NvidiaTuring;
        }
        if n.contains("gtx 10") || n.contains("p100") || n.contains("p40") {
            return GpuArch::NvidiaPascal;
        }
    }

    // AMD — RDNA generation by model number. RX 9xxx = RDNA4 ,
    // RX 7xxx = RDNA3 , RX 6xxx = RDNA2.
    if n.contains("amd") || n.contains("radeon") {
        if n.contains("rx 9") || n.contains("rx9") {
            return GpuArch::AmdRdna4;
        }
        if n.contains("rx 7") || n.contains("rx7") {
            return GpuArch::AmdRdna3;
        }
        if n.contains("rx 6") || n.contains("rx6") {
            return GpuArch::AmdRdna2;
        }
    }

    if n.contains("intel") {
        if n.contains("arc") {
            return GpuArch::IntelArc;
        }
        if n.contains("iris") || n.contains("uhd") {
            return GpuArch::IntelIris;
        }
    }

    // Apple Silicon — wizard doesn't run on Mac in v0.3 but classify
    // anyway for future-proofing ( the same hardware.rs can serve the
    // bundled Mac-installer when that ships ).
    if n.contains("apple m4") {
        return GpuArch::AppleM4;
    }
    if n.contains("apple m3") {
        return GpuArch::AppleM3;
    }
    if n.contains("apple m2") {
        return GpuArch::AppleM2;
    }
    if n.contains("apple m1") {
        return GpuArch::AppleM1;
    }

    GpuArch::Other
}

// --- Recommendation ------------------------------------------------------

const GB: u64 = 1024 * 1024 * 1024;

pub fn recommend(p: &HardwareProfile) -> Tier {
    let vram_gb = p.gpu_vram_bytes.unwrap_or(0) / GB;
    let ram_gb = p.ram_bytes / GB;

    // Tier 1 cut : memory capacity. Budgets per tier ( from plan-doc ) :
    //   Pro      ~8 GB   ( Qwen3.5-9B Q4 5.7 + KV 1.5 + bge-m3 0.5 + reranker 0.5 )
    //   Standard ~4.5 GB ( Qwen3.5-4B Q4 2.8 + KV 1 + bge-m3 0.5 , reranker opt-in )
    //   Lite     ~2 GB   ( Qwen3.5-2B Q4 1.2 + small embedder , CPU offload ok )
    //
    // Thresholds are conservative ( recommend down rather than risk OOM
    // at load ). User can always override on the picker.
    let memory_tier = if vram_gb >= 8 {
        Tier::Pro
    } else if vram_gb >= 4 {
        Tier::Standard
    } else {
        // CPU-only or <4 GB GPU : land on Lite. RAM >= 8 GB ist for Lite
        // pleasant on CPU ; less than that and the wizard should warn
        // ( UI concern ).
        let _ = ram_gb;
        Tier::Lite
    };

    // Tier 2 cut : chip-type adjustments for boundary cases.
    match (memory_tier, p.gpu_arch) {
        // Apple Silicon unified memory : wgpu reports a small per-buffer
        // limit but the chip can use all of system RAM. The 16-GB-first
        // arm has to come before the 8-GB-first arm because match arms
        // resolve top-to-bottom.
        (Tier::Lite, Some(GpuArch::AppleM2 | GpuArch::AppleM3 | GpuArch::AppleM4))
            if ram_gb >= 16 =>
        {
            Tier::Pro
        }
        (Tier::Lite, Some(GpuArch::AppleM2 | GpuArch::AppleM3 | GpuArch::AppleM4))
            if ram_gb >= 8 =>
        {
            Tier::Standard
        }

        // Old Nvidia ( Pascal , Turing ) with 8+ GB is misleading — slow
        // tensor performance kills Pro experience. Cap at Standard.
        (Tier::Pro, Some(GpuArch::NvidiaPascal | GpuArch::NvidiaTuring)) => Tier::Standard,

        (t, _) => t,
    }
}

// --- Tests ---------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn make(vram_gb: Option<u64>, ram_gb: u64, arch: Option<GpuArch>) -> HardwareProfile {
        HardwareProfile {
            gpu_name: arch.map(|_| "test".into()),
            gpu_vram_bytes: vram_gb.map(|g| g * GB),
            gpu_arch: arch,
            cpu_threads: 8,
            cpu_brand: "test".into(),
            ram_bytes: ram_gb * GB,
            recommended_tier: Tier::Lite,
        }
    }

    #[test]
    fn rtx_5090_lands_pro() {
        let p = make(Some(32), 64, Some(GpuArch::NvidiaBlackwell));
        assert_eq!(recommend(&p), Tier::Pro);
    }

    #[test]
    fn rtx_4080_lands_pro() {
        // 16 GB VRAM , Ada — well above the 8 GB Pro threshold.
        let p = make(Some(16), 32, Some(GpuArch::NvidiaAda));
        assert_eq!(recommend(&p), Tier::Pro);
    }

    #[test]
    fn rtx_4070_lands_pro() {
        // 12 GB Ada — still Pro under the new 8 GB threshold ( old plan
        // had this at Normal back when Pro = Qwen3-14B ).
        let p = make(Some(12), 32, Some(GpuArch::NvidiaAda));
        assert_eq!(recommend(&p), Tier::Pro);
    }

    #[test]
    fn rtx_4060_8gb_lands_pro() {
        // 8 GB Ada mobile : sits right at the Pro threshold ( Qwen3.5-9B
        // 5.7 GB + KV + embedder + reranker ≈ 8 GB budget , tight but ok ).
        let p = make(Some(8), 16, Some(GpuArch::NvidiaAda));
        assert_eq!(recommend(&p), Tier::Pro);
    }

    #[test]
    fn rtx_3050_6gb_lands_standard() {
        // 6 GB GPU : not enough headroom for Pro ( 9B + KV ) , but
        // Standard ( 4B + KV ) fits comfortably.
        let p = make(Some(6), 16, Some(GpuArch::NvidiaAmpere));
        assert_eq!(recommend(&p), Tier::Standard);
    }

    #[test]
    fn old_titan_v_pascal_24gb_caps_at_standard() {
        // Pascal Titan V with 24 GB VRAM would land Pro by memory alone ,
        // but chip-type cut caps at Standard because tensor perf is weak.
        let p = make(Some(24), 64, Some(GpuArch::NvidiaPascal));
        assert_eq!(recommend(&p), Tier::Standard);
    }

    #[test]
    fn cpu_only_lands_lite() {
        let p = make(None, 32, None);
        assert_eq!(recommend(&p), Tier::Lite);
    }

    #[test]
    fn apple_m3_16gb_lands_pro() {
        // 16 GB unified Apple Silicon : wgpu reports tiny per-buffer
        // limit but the chip can use all RAM. Pro tier is the right call.
        let p = make(Some(2), 16, Some(GpuArch::AppleM3));
        assert_eq!(recommend(&p), Tier::Pro);
    }

    #[test]
    fn apple_m2_8gb_lands_standard() {
        // 8 GB unified M2 : Standard is appropriate ( Qwen3.5-4B fits ,
        // 9B would be too tight with macOS overhead ).
        let p = make(Some(2), 8, Some(GpuArch::AppleM2));
        assert_eq!(recommend(&p), Tier::Standard);
    }

    #[test]
    fn classify_rtx_5090() {
        assert_eq!(
            classify_gpu_arch("NVIDIA GeForce RTX 5090"),
            GpuArch::NvidiaBlackwell
        );
    }

    #[test]
    fn classify_rtx_4090() {
        assert_eq!(
            classify_gpu_arch("NVIDIA GeForce RTX 4090"),
            GpuArch::NvidiaAda
        );
    }

    #[test]
    fn classify_rx_7900_xtx() {
        assert_eq!(
            classify_gpu_arch("AMD Radeon RX 7900 XTX"),
            GpuArch::AmdRdna3
        );
    }

    #[test]
    fn classify_unknown_falls_back() {
        assert_eq!(classify_gpu_arch("some weird gpu"), GpuArch::Other);
    }

    // DXGI VRAM selection. Tuples are ( vendor_id , device_id , dedicated VRAM ).
    // 0x1002 = AMD , 0x1414 = Microsoft ( Basic Render Driver , dedVRAM 0 ).

    #[test]
    fn dxgi_exact_match_wins() {
        // 760M iGPU : wgpu device id agrees with DXGI , exact match returns
        // the 512 MB carve-out.
        let adapters = [(0x1002, 0x1900, GB / 2), (0x1414, 0x008c, 0)];
        assert_eq!(select_dxgi_vram(&adapters, 0x1002, 0x1900), Some(GB / 2));
    }

    #[test]
    fn dxgi_vendor_fallback_when_device_id_mismatches() {
        // Discrete AMD card : wgpu's Vulkan backend reports a device id that
        // DXGI doesn't list. Exact match misses ; the same-vendor fallback
        // recovers the real 24 GB instead of the 80-GiB wgpu sentinel.
        let adapters = [(0x1002, 0x7448, 24 * GB), (0x1414, 0x008c, 0)];
        assert_eq!(select_dxgi_vram(&adapters, 0x1002, 0x9999), Some(24 * GB));
    }

    #[test]
    fn dxgi_fallback_picks_largest_same_vendor() {
        // AMD iGPU + AMD dGPU , wgpu device id matches neither. Pick the
        // dGPU's larger VRAM , not the iGPU carve-out.
        let adapters = [
            (0x1002, 0x1900, GB / 2),
            (0x1002, 0x7448, 24 * GB),
            (0x1414, 0x008c, 0),
        ];
        assert_eq!(select_dxgi_vram(&adapters, 0x1002, 0x0000), Some(24 * GB));
    }

    #[test]
    fn dxgi_no_same_vendor_returns_none() {
        // Only the software renderer present : nothing for the queried
        // vendor , so fall through ( caller uses the wgpu estimate ).
        let adapters = [(0x1414, 0x008c, 0)];
        assert_eq!(select_dxgi_vram(&adapters, 0x1002, 0x1900), None);
    }
}
