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
    Light,
    Normal,
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
        recommended_tier: Tier::Light,
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

    // wgpu does not expose dedicated VRAM directly. limits().max_buffer_size
    // is a usable lower-bound on most drivers — DX12 reports the heap budget
    // here , Vulkan reports VkPhysicalDeviceMemoryProperties largest heap ,
    // Metal reports recommended-working-set. None of these are exact , but
    // for tier-detection ( "is it 6 / 14 / 20+ GB ? " ) they're good enough.
    //
    // On software/integrated adapters this can be misleadingly small or
    // huge ( shared system RAM ) ; we already filtered those above.
    let vram_bytes = adapter.limits().max_buffer_size;

    let arch = classify_gpu_arch(&name);

    (Some(name), Some(vram_bytes), Some(arch))
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
    //   Pro    ~14 GB  ( Qwen3-14B Q4 8.5 + KV 3 + bge-m3 0.5 + reranker 0.5 + headroom )
    //   Normal ~7 GB   ( Qwen3-8B Q4 5 + KV 1.5 + bge-m3 0.5 )
    //   Light  ~3 GB   ( Qwen3-4B Q4 2.5 + small embedder , CPU offload ok )
    let memory_tier = if vram_gb >= 14 {
        Tier::Pro
    } else if vram_gb >= 6 {
        Tier::Normal
    } else {
        // CPU-only or low-VRAM : land on Light. RAM >= 16 GB is required
        // for Light to be pleasant on CPU ; less than that and the user
        // is still on Light but the wizard should warn ( UI concern ).
        let _ = ram_gb;
        Tier::Light
    };

    // Tier 2 cut : chip-type adjustments for boundary cases.
    match (memory_tier, p.gpu_arch) {
        // RTX 40/50-series laptop SKUs with marginal VRAM ( 8 GB Ada
        // mobile ) can still handle Normal cleanly thanks to fast memory
        // bandwidth + tensor cores. Bump Light → Normal.
        (Tier::Light, Some(GpuArch::NvidiaAda | GpuArch::NvidiaBlackwell)) if vram_gb >= 5 => {
            Tier::Normal
        }

        // Apple Silicon unified memory : wgpu reports a small per-buffer
        // limit but the chip can use all of system RAM. M2/M3/M4 with
        // 16+ GB → Normal , M3/M4 with 32+ GB → Pro.
        (Tier::Light, Some(GpuArch::AppleM2 | GpuArch::AppleM3 | GpuArch::AppleM4))
            if ram_gb >= 16 =>
        {
            Tier::Normal
        }
        (Tier::Light, Some(GpuArch::AppleM3 | GpuArch::AppleM4)) if ram_gb >= 32 => Tier::Pro,

        // Old Nvidia ( Pascal , Turing ) with 16+ GB is misleading — slow
        // tensor performance kills Pro experience. Downgrade.
        (Tier::Pro, Some(GpuArch::NvidiaPascal | GpuArch::NvidiaTuring)) => Tier::Normal,

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
            recommended_tier: Tier::Light,
        }
    }

    #[test]
    fn rtx_5090_lands_pro() {
        let p = make(Some(32), 64, Some(GpuArch::NvidiaBlackwell));
        assert_eq!(recommend(&p), Tier::Pro);
    }

    #[test]
    fn rtx_4080_lands_pro() {
        // 16 GB VRAM , Ada — comfortably above the 14 GB Pro threshold.
        let p = make(Some(16), 32, Some(GpuArch::NvidiaAda));
        assert_eq!(recommend(&p), Tier::Pro);
    }

    #[test]
    fn rtx_4070_lands_normal() {
        // 12 GB VRAM , Ada — above Normal threshold ( 6 GB ) , below Pro ( 14 GB ).
        let p = make(Some(12), 32, Some(GpuArch::NvidiaAda));
        assert_eq!(recommend(&p), Tier::Normal);
    }

    #[test]
    fn rtx_4060_laptop_8gb_lands_normal_via_chip_bonus() {
        // 8 GB Ada mobile : memory cut says Normal directly ( >= 6 GB ).
        let p = make(Some(8), 16, Some(GpuArch::NvidiaAda));
        assert_eq!(recommend(&p), Tier::Normal);
    }

    #[test]
    fn old_titan_v_pascal_24gb_downgrades_to_normal() {
        // Pascal Titan V with 24 GB VRAM would land Pro by memory alone ,
        // but chip-type cut downgrades to Normal because tensor perf is weak.
        let p = make(Some(24), 64, Some(GpuArch::NvidiaPascal));
        assert_eq!(recommend(&p), Tier::Normal);
    }

    #[test]
    fn cpu_only_lands_light() {
        let p = make(None, 32, None);
        assert_eq!(recommend(&p), Tier::Light);
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
}
