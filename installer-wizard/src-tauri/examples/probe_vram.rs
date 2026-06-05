// Quick one-shot to validate the GPU/VRAM probe on the host machine.
// Run with: cargo run --example probe_vram
//
// Bypasses Windows IDT auto-elevation by setting __COMPAT_LAYER=RunAsInvoker
// for the calling shell ; the example binary inherits the "installer" crate
// name and would otherwise prompt UAC.
//
// Dumps the raw wgpu adapter list and the raw DXGI adapter list side by side
// BEFORE the probe summary, so a vendor/device-ID mismatch between the two
// ( the cause of the discrete-AMD "80 GiB" fallback ) is visible directly.

#[path = "../src/installer/hardware.rs"]
mod hardware;

fn main() {
    dump_wgpu_adapters();
    #[cfg(target_os = "windows")]
    dump_dxgi_adapters();

    println!("\n=== hardware::probe() result ===");
    let p = hardware::probe();
    println!("gpu_name        = {:?}", p.gpu_name);
    println!(
        "gpu_vram_bytes  = {:?} ({:.2} GiB)",
        p.gpu_vram_bytes,
        p.gpu_vram_bytes.unwrap_or(0) as f64 / (1024.0 * 1024.0 * 1024.0)
    );
    println!("gpu_arch        = {:?}", p.gpu_arch);
    println!("cpu_brand       = {}", p.cpu_brand);
    println!("cpu_threads     = {}", p.cpu_threads);
    println!(
        "ram_bytes       = {} ({:.2} GiB)",
        p.ram_bytes,
        p.ram_bytes as f64 / (1024.0 * 1024.0 * 1024.0)
    );
    println!("recommended_tier = {:?}", p.recommended_tier);
}

fn dump_wgpu_adapters() {
    println!("=== wgpu adapters ( Backends::PRIMARY ) ===");
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::PRIMARY,
        ..Default::default()
    });
    for a in instance.enumerate_adapters(wgpu::Backends::PRIMARY) {
        let i = a.get_info();
        let mbs = a.limits().max_buffer_size;
        println!(
            "  [{:?}] {:<40} vendor=0x{:04x} device=0x{:04x} type={:?} max_buffer_size={} ({:.2} GiB)",
            i.backend,
            i.name,
            i.vendor,
            i.device,
            i.device_type,
            mbs,
            mbs as f64 / (1024.0 * 1024.0 * 1024.0),
        );
    }
}

#[cfg(target_os = "windows")]
fn dump_dxgi_adapters() {
    use windows::Win32::Graphics::Dxgi::{
        CreateDXGIFactory1, IDXGIAdapter1, IDXGIFactory1, DXGI_ADAPTER_DESC1,
    };
    println!("\n=== DXGI adapters ( IDXGIFactory1::EnumAdapters1 ) ===");
    unsafe {
        let factory: IDXGIFactory1 = match CreateDXGIFactory1() {
            Ok(f) => f,
            Err(e) => {
                println!("  CreateDXGIFactory1 failed: {e:?}");
                return;
            }
        };
        for idx in 0u32..32 {
            let adapter: IDXGIAdapter1 = match factory.EnumAdapters1(idx) {
                Ok(a) => a,
                Err(_) => break,
            };
            let mut desc = DXGI_ADAPTER_DESC1::default();
            if adapter.GetDesc1(&mut desc).is_err() {
                continue;
            }
            let name = String::from_utf16_lossy(&desc.Description);
            let name = name.trim_end_matches('\0').trim();
            println!(
                "  [{idx}] {:<40} vendor=0x{:04x} device=0x{:04x} dedVRAM={} ({:.2} GiB) dedSys={} sharedSys={} ({:.2} GiB)",
                name,
                desc.VendorId,
                desc.DeviceId,
                desc.DedicatedVideoMemory,
                desc.DedicatedVideoMemory as f64 / (1024.0 * 1024.0 * 1024.0),
                desc.DedicatedSystemMemory,
                desc.SharedSystemMemory,
                desc.SharedSystemMemory as f64 / (1024.0 * 1024.0 * 1024.0),
            );
        }
    }
}
