// exp01 — CUDA toolchain: load module, dump PTX info, launch noop kernel.
#include "cuda_context.h"
#include <cstdio>
#include <cstdlib>
#include <string>

// Defined by DumpSASS.cmake at build time (the .sass file path)
// For runtime, we just launch the kernel and print PTX/SASS info.

// Forward declaration of the CUDA kernel (compiled from noop_kernel.cu)
extern "C" __global__ void noop_kernel();

int main() {
    printf("=== exp01: CUDA Toolchain Anatomy ===\n\n");

    auto ctx = cuutil::createContext();

    // Launch the noop kernel via Runtime API style
    // (linked at compile time from noop_kernel.cu)
    printf("Launching noop_kernel...\n");
    noop_kernel<<<1, 64>>>();

    CUresult syncResult = cuCtxSynchronize();
    if (syncResult != CUDA_SUCCESS) {
        const char* errStr = nullptr;
        cuGetErrorString(syncResult, &errStr);
        fprintf(stderr, "Sync error: %s\n", errStr ? errStr : "unknown");
        return 1;
    }
    printf("noop_kernel completed successfully.\n\n");

    printf("SASS dump was generated at build time via cuobjdump.\n");
    printf("Check the build/sass/ directory for exp01_cuda.sass\n");

    ctx.destroy();
    return 0;
}
