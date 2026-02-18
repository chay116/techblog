// exp03 — Memory Coalescing: AoS vs SoA, CUDA and Vulkan.
// Measures bandwidth for reading x field from 4-component structs.
#include "cuda_context.h"
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <vector>

struct Particle {
    float x, y, z, w;
};

// CUDA kernels
extern "C" __global__ void read_aos_x(const Particle*, float*, int);
extern "C" __global__ void read_soa_x(const float*, float*, int);

int main() {
    printf("=== exp03: Memory Coalescing at SASS Level ===\n\n");

    const int N = 4 << 20;  // 4M particles
    const int iters = 100;

    auto ctx = cuutil::createContext();

    // --- AoS path ---
    std::vector<Particle> hAoS(N);
    for (int i = 0; i < N; ++i) hAoS[i] = {float(i), 0, 0, 0};

    Particle* dAoS;
    float* dOut;
    cudaMalloc(&dAoS, N * sizeof(Particle));
    cudaMalloc(&dOut, N * sizeof(float));
    cudaMemcpy(dAoS, hAoS.data(), N * sizeof(Particle), cudaMemcpyHostToDevice);

    int block = 256;
    int grid = (N + block - 1) / block;

    // Warmup
    read_aos_x<<<grid, block>>>(dAoS, dOut, N);
    cudaDeviceSynchronize();

    auto t0 = std::chrono::high_resolution_clock::now();
    for (int i = 0; i < iters; ++i)
        read_aos_x<<<grid, block>>>(dAoS, dOut, N);
    cudaDeviceSynchronize();
    auto t1 = std::chrono::high_resolution_clock::now();
    double aosMs = std::chrono::duration<double, std::milli>(t1 - t0).count() / iters;

    // --- SoA path ---
    std::vector<float> hX(N);
    for (int i = 0; i < N; ++i) hX[i] = float(i);

    float* dX;
    cudaMalloc(&dX, N * sizeof(float));
    cudaMemcpy(dX, hX.data(), N * sizeof(float), cudaMemcpyHostToDevice);

    read_soa_x<<<grid, block>>>(dX, dOut, N);
    cudaDeviceSynchronize();

    t0 = std::chrono::high_resolution_clock::now();
    for (int i = 0; i < iters; ++i)
        read_soa_x<<<grid, block>>>(dX, dOut, N);
    cudaDeviceSynchronize();
    t1 = std::chrono::high_resolution_clock::now();
    double soaMs = std::chrono::duration<double, std::milli>(t1 - t0).count() / iters;

    printf("CUDA AoS (x field read): %.3f ms  (%.1f GB/s effective)\n",
           aosMs, (N * sizeof(float) / 1e9) / (aosMs / 1e3));
    printf("CUDA SoA (x field read): %.3f ms  (%.1f GB/s effective)\n",
           soaMs, (N * sizeof(float) / 1e9) / (soaMs / 1e3));
    printf("Speedup SoA/AoS: %.2fx\n\n", aosMs / soaMs);

    printf("Check SASS dumps in build/sass/ for LDG instruction differences.\n");
    printf("Vulkan variants: run with pipeline executable properties enabled.\n");

    cudaFree(dAoS);
    cudaFree(dX);
    cudaFree(dOut);
    ctx.destroy();
    return 0;
}
