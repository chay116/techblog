// coalesce_aos.cu — Read x field from AoS layout.
// struct { float x, y, z, w; } — stride-4 access, poor coalescing on x.

struct Particle {
    float x, y, z, w;
};

extern "C" __global__ void read_aos_x(const Particle* particles, float* out,
                                       int N) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx < N) {
        out[idx] = particles[idx].x;
    }
}
