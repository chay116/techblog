// vector_add.cu — C[i] = A[i] + B[i]
// Identical logic to glsl/vector_add.comp for 1:1 SASS comparison.

extern "C" __global__ void vector_add(const float* A, const float* B,
                                       float* C, int N) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx < N) {
        C[idx] = A[idx] + B[idx];
    }
}
