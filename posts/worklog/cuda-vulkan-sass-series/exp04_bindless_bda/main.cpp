// exp04 — Bindless & BDA: CUDA raw pointer vs Vulkan UBO vs Vulkan BDA.
// Compares SASS to validate Aaltonen's convergence thesis.
#include "cuda_context.h"
#include <chrono>
#include <cstdio>
#include <vector>

extern "C" __global__ void read_via_pointer(const float*, float*, int);

int main() {
    printf("=== exp04: Bindless, BDA, Raw Pointers ===\n\n");

    const int N = 1 << 20;
    const int iters = 100;

    auto ctx = cuutil::createContext();

    std::vector<float> hIn(N, 1.5f), hOut(N, 0.0f);
    float *dIn, *dOut;
    cudaMalloc(&dIn, N * sizeof(float));
    cudaMalloc(&dOut, N * sizeof(float));
    cudaMemcpy(dIn, hIn.data(), N * sizeof(float), cudaMemcpyHostToDevice);

    int block = 256;
    int grid = (N + block - 1) / block;

    // Warmup
    read_via_pointer<<<grid, block>>>(dIn, dOut, N);
    cudaDeviceSynchronize();

    auto t0 = std::chrono::high_resolution_clock::now();
    for (int i = 0; i < iters; ++i)
        read_via_pointer<<<grid, block>>>(dIn, dOut, N);
    cudaDeviceSynchronize();
    auto t1 = std::chrono::high_resolution_clock::now();

    double ms = std::chrono::duration<double, std::milli>(t1 - t0).count() / iters;
    printf("CUDA raw pointer: %.3f ms/iter\n", ms);

    // Verify
    cudaMemcpy(hOut.data(), dOut, N * sizeof(float), cudaMemcpyDeviceToHost);
    printf("Verify: out[0] = %.1f (expected 3.0)\n\n", hOut[0]);

    printf("SASS comparison:\n");
    printf("  CUDA raw_ptr  → LDG/STG with register-based addressing\n");
    printf("  Vulkan UBO    → descriptor-indirect load (check SASS)\n");
    printf("  Vulkan BDA    → should converge to LDG/STG like CUDA\n\n");
    printf("See build/sass/ for CUDA SASS. Run Vulkan with pipeline exec props for Vulkan SASS.\n");

    cudaFree(dIn);
    cudaFree(dOut);
    ctx.destroy();
    return 0;
}
