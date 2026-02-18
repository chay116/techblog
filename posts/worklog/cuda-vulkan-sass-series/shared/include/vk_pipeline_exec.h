#pragma once

#include <vulkan/vulkan.h>
#include <string>
#include <vector>

namespace vkutil {

/// Helper for VK_KHR_pipeline_executable_properties.
/// Dumps ISA (internal representations) for a pipeline.
struct PipelineExecDumper {
    PFN_vkGetPipelineExecutablePropertiesKHR fpGetProps = nullptr;
    PFN_vkGetPipelineExecutableInternalRepresentationsKHR fpGetIR = nullptr;

    /// Initialize function pointers from the device.
    bool init(VkDevice device);

    /// Dump all internal representations (ISA) for the given pipeline.
    /// Returns the ISA text if found, or empty string.
    std::string dumpISA(VkDevice device, VkPipeline pipeline);
};

}  // namespace vkutil
