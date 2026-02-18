#pragma once

#include <vulkan/vulkan.h>
#include <string>
#include <vector>

namespace vkutil {

/// Vulkan compute context — instance, physical device, logical device, queue.
struct VkContext {
    VkInstance instance = VK_NULL_HANDLE;
    VkPhysicalDevice physicalDevice = VK_NULL_HANDLE;
    VkDevice device = VK_NULL_HANDLE;
    VkQueue computeQueue = VK_NULL_HANDLE;
    uint32_t computeQueueFamily = 0;
    VkPhysicalDeviceMemoryProperties memProps{};

    void destroy();
};

/// Create a Vulkan compute context targeting the first NVIDIA discrete GPU.
/// Enables VK_KHR_pipeline_executable_properties if available.
VkContext createComputeContext(bool enablePipelineExecProps = false);

/// Find a memory type index matching the given filter and property flags.
uint32_t findMemoryType(const VkContext& ctx, uint32_t typeFilter,
                        VkMemoryPropertyFlags properties);

/// Create a device-local buffer with the given size and usage.
VkBuffer createBuffer(const VkContext& ctx, VkDeviceSize size,
                      VkBufferUsageFlags usage, VkDeviceMemory& memory);

/// Create a command pool for the compute queue family.
VkCommandPool createCommandPool(const VkContext& ctx);

/// Allocate a single primary command buffer from the pool.
VkCommandBuffer allocateCommandBuffer(const VkContext& ctx, VkCommandPool pool);

/// Submit a command buffer and wait for completion via fence.
void submitAndWait(const VkContext& ctx, VkCommandBuffer cmd);

}  // namespace vkutil
