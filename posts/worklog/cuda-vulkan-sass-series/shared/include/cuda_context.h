#pragma once

#include <cuda.h>
#include <string>

namespace cuutil {

/// CUDA Driver API context wrapper.
struct CudaContext {
    CUdevice device = 0;
    CUcontext context = nullptr;

    void destroy();
};

/// Initialize the CUDA Driver API and create a context on device 0.
CudaContext createContext(int deviceOrdinal = 0);

/// Load a PTX or cubin module from file.
CUmodule loadModule(const std::string& path);

/// Get a kernel function from a module by name.
CUfunction getFunction(CUmodule module, const std::string& name);

/// Allocate device memory and return device pointer.
CUdeviceptr allocDevice(size_t bytes);

/// Free device memory.
void freeDevice(CUdeviceptr ptr);

/// Copy host → device.
void copyToDevice(CUdeviceptr dst, const void* src, size_t bytes);

/// Copy device → host.
void copyToHost(void* dst, CUdeviceptr src, size_t bytes);

}  // namespace cuutil
