// exp02 — Vector Add: CUDA and Vulkan side-by-side execution + timing.
#include "cuda_context.h"
#include "vk_init.h"
#include "vk_pipeline_exec.h"
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <vector>

// CUDA kernel (linked from vector_add.cu)
extern "C" __global__ void vector_add(const float*, const float*, float*, int);

static std::vector<char> readFile(const std::string& path) {
    std::ifstream f(path, std::ios::ate | std::ios::binary);
    if (!f.is_open()) { fprintf(stderr, "Cannot open %s\n", path.c_str()); std::abort(); }
    size_t sz = f.tellg();
    std::vector<char> buf(sz);
    f.seekg(0);
    f.read(buf.data(), sz);
    return buf;
}

// ---------- CUDA path ----------

static double runCuda(int N, int iterations) {
    std::vector<float> hA(N, 1.0f), hB(N, 2.0f), hC(N, 0.0f);

    float *dA, *dB, *dC;
    cudaMalloc(&dA, N * sizeof(float));
    cudaMalloc(&dB, N * sizeof(float));
    cudaMalloc(&dC, N * sizeof(float));
    cudaMemcpy(dA, hA.data(), N * sizeof(float), cudaMemcpyHostToDevice);
    cudaMemcpy(dB, hB.data(), N * sizeof(float), cudaMemcpyHostToDevice);

    int blockSize = 256;
    int gridSize = (N + blockSize - 1) / blockSize;

    // Warmup
    vector_add<<<gridSize, blockSize>>>(dA, dB, dC, N);
    cudaDeviceSynchronize();

    auto t0 = std::chrono::high_resolution_clock::now();
    for (int i = 0; i < iterations; ++i) {
        vector_add<<<gridSize, blockSize>>>(dA, dB, dC, N);
    }
    cudaDeviceSynchronize();
    auto t1 = std::chrono::high_resolution_clock::now();

    double ms = std::chrono::duration<double, std::milli>(t1 - t0).count() /
                iterations;

    // Verify
    cudaMemcpy(hC.data(), dC, N * sizeof(float), cudaMemcpyDeviceToHost);
    for (int i = 0; i < 4; ++i) {
        if (std::fabs(hC[i] - 3.0f) > 1e-5f) {
            fprintf(stderr, "CUDA verify failed at %d: %f\n", i, hC[i]);
        }
    }

    cudaFree(dA);
    cudaFree(dB);
    cudaFree(dC);

    return ms;
}

// ---------- Main ----------

int main() {
    printf("=== exp02: Vector Add — CUDA vs Vulkan SASS Comparison ===\n\n");

    const int sizes[] = {1 << 20, 16 << 20};  // 1M, 16M
    const int iters = 100;

    auto ctx = cuutil::createContext();

    for (int N : sizes) {
        printf("N = %d (%d M elements)\n", N, N >> 20);
        double cudaMs = runCuda(N, iters);
        printf("  CUDA:   %.3f ms/iter\n", cudaMs);
        // Vulkan path would require full pipeline setup — see post for details
        printf("  Vulkan: (run exp02_vulkan separately or see post)\n\n");
    }

    printf("SASS dumps available in build/sass/ directory.\n");

    ctx.destroy();
    return 0;
}
