#include "vk_init.h"
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <stdexcept>

#define VK_CHECK(call)                                                   \
    do {                                                                 \
        VkResult r = (call);                                             \
        if (r != VK_SUCCESS) {                                           \
            fprintf(stderr, "Vulkan error %d at %s:%d\n", r, __FILE__,  \
                    __LINE__);                                           \
            std::abort();                                                \
        }                                                                \
    } while (0)

namespace vkutil {

void VkContext::destroy() {
    if (device) vkDestroyDevice(device, nullptr);
    if (instance) vkDestroyInstance(instance, nullptr);
    device = VK_NULL_HANDLE;
    instance = VK_NULL_HANDLE;
}

VkContext createComputeContext(bool enablePipelineExecProps) {
    VkContext ctx{};

    // --- Instance ---
    VkApplicationInfo appInfo{VK_STRUCTURE_TYPE_APPLICATION_INFO};
    appInfo.pApplicationName = "sass-series";
    appInfo.apiVersion = VK_API_VERSION_1_2;

    VkInstanceCreateInfo instCI{VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO};
    instCI.pApplicationInfo = &appInfo;
    VK_CHECK(vkCreateInstance(&instCI, nullptr, &ctx.instance));

    // --- Physical device (prefer NVIDIA discrete) ---
    uint32_t gpuCount = 0;
    vkEnumeratePhysicalDevices(ctx.instance, &gpuCount, nullptr);
    std::vector<VkPhysicalDevice> gpus(gpuCount);
    vkEnumeratePhysicalDevices(ctx.instance, &gpuCount, gpus.data());

    for (auto& gpu : gpus) {
        VkPhysicalDeviceProperties props;
        vkGetPhysicalDeviceProperties(gpu, &props);
        if (props.deviceType == VK_PHYSICAL_DEVICE_TYPE_DISCRETE_GPU &&
            props.vendorID == 0x10DE) {
            ctx.physicalDevice = gpu;
            printf("Selected GPU: %s\n", props.deviceName);
            break;
        }
    }
    if (!ctx.physicalDevice && gpuCount > 0) {
        ctx.physicalDevice = gpus[0];
    }
    if (!ctx.physicalDevice) {
        throw std::runtime_error("No Vulkan GPU found");
    }

    vkGetPhysicalDeviceMemoryProperties(ctx.physicalDevice, &ctx.memProps);

    // --- Queue family (compute) ---
    uint32_t qfCount = 0;
    vkGetPhysicalDeviceQueueFamilyProperties(ctx.physicalDevice, &qfCount,
                                             nullptr);
    std::vector<VkQueueFamilyProperties> qfProps(qfCount);
    vkGetPhysicalDeviceQueueFamilyProperties(ctx.physicalDevice, &qfCount,
                                             qfProps.data());

    for (uint32_t i = 0; i < qfCount; ++i) {
        if (qfProps[i].queueFlags & VK_QUEUE_COMPUTE_BIT) {
            ctx.computeQueueFamily = i;
            break;
        }
    }

    // --- Logical device ---
    float priority = 1.0f;
    VkDeviceQueueCreateInfo qCI{VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO};
    qCI.queueFamilyIndex = ctx.computeQueueFamily;
    qCI.queueCount = 1;
    qCI.pQueuePriorities = &priority;

    std::vector<const char*> deviceExts;
    if (enablePipelineExecProps) {
        deviceExts.push_back(
            VK_KHR_PIPELINE_EXECUTABLE_PROPERTIES_EXTENSION_NAME);
    }

    VkPhysicalDeviceFeatures2 features2{
        VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_FEATURES_2};

    VkPhysicalDevicePipelineExecutablePropertiesFeaturesKHR execFeat{
        VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_PIPELINE_EXECUTABLE_PROPERTIES_FEATURES_KHR};
    execFeat.pipelineExecutableInfo = VK_TRUE;

    if (enablePipelineExecProps) {
        features2.pNext = &execFeat;
    }

    VkDeviceCreateInfo devCI{VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO};
    devCI.pNext = &features2;
    devCI.queueCreateInfoCount = 1;
    devCI.pQueueCreateInfos = &qCI;
    devCI.enabledExtensionCount = static_cast<uint32_t>(deviceExts.size());
    devCI.ppEnabledExtensionNames = deviceExts.data();

    VK_CHECK(vkCreateDevice(ctx.physicalDevice, &devCI, nullptr, &ctx.device));
    vkGetDeviceQueue(ctx.device, ctx.computeQueueFamily, 0,
                     &ctx.computeQueue);

    return ctx;
}

uint32_t findMemoryType(const VkContext& ctx, uint32_t typeFilter,
                        VkMemoryPropertyFlags properties) {
    for (uint32_t i = 0; i < ctx.memProps.memoryTypeCount; ++i) {
        if ((typeFilter & (1 << i)) &&
            (ctx.memProps.memoryTypes[i].propertyFlags & properties) ==
                properties) {
            return i;
        }
    }
    throw std::runtime_error("Failed to find suitable memory type");
}

VkBuffer createBuffer(const VkContext& ctx, VkDeviceSize size,
                      VkBufferUsageFlags usage, VkDeviceMemory& memory) {
    VkBufferCreateInfo bufCI{VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO};
    bufCI.size = size;
    bufCI.usage = usage;
    bufCI.sharingMode = VK_SHARING_MODE_EXCLUSIVE;

    VkBuffer buffer;
    VK_CHECK(vkCreateBuffer(ctx.device, &bufCI, nullptr, &buffer));

    VkMemoryRequirements memReqs;
    vkGetBufferMemoryRequirements(ctx.device, buffer, &memReqs);

    VkMemoryAllocateInfo allocInfo{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
    allocInfo.allocationSize = memReqs.size;
    allocInfo.memoryTypeIndex = findMemoryType(
        ctx, memReqs.memoryTypeBits,
        VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT |
            VK_MEMORY_PROPERTY_HOST_COHERENT_BIT);

    VK_CHECK(vkAllocateMemory(ctx.device, &allocInfo, nullptr, &memory));
    VK_CHECK(vkBindBufferMemory(ctx.device, buffer, memory, 0));

    return buffer;
}

VkCommandPool createCommandPool(const VkContext& ctx) {
    VkCommandPoolCreateInfo poolCI{
        VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO};
    poolCI.flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT;
    poolCI.queueFamilyIndex = ctx.computeQueueFamily;

    VkCommandPool pool;
    VK_CHECK(vkCreateCommandPool(ctx.device, &poolCI, nullptr, &pool));
    return pool;
}

VkCommandBuffer allocateCommandBuffer(const VkContext& ctx,
                                       VkCommandPool pool) {
    VkCommandBufferAllocateInfo allocInfo{
        VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO};
    allocInfo.commandPool = pool;
    allocInfo.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
    allocInfo.commandBufferCount = 1;

    VkCommandBuffer cmd;
    VK_CHECK(vkAllocateCommandBuffers(ctx.device, &allocInfo, &cmd));
    return cmd;
}

void submitAndWait(const VkContext& ctx, VkCommandBuffer cmd) {
    VkFenceCreateInfo fenceCI{VK_STRUCTURE_TYPE_FENCE_CREATE_INFO};
    VkFence fence;
    VK_CHECK(vkCreateFence(ctx.device, &fenceCI, nullptr, &fence));

    VkSubmitInfo submitInfo{VK_STRUCTURE_TYPE_SUBMIT_INFO};
    submitInfo.commandBufferCount = 1;
    submitInfo.pCommandBuffers = &cmd;

    VK_CHECK(vkQueueSubmit(ctx.computeQueue, 1, &submitInfo, fence));
    VK_CHECK(vkWaitForFences(ctx.device, 1, &fence, VK_TRUE, UINT64_MAX));

    vkDestroyFence(ctx.device, fence, nullptr);
}

}  // namespace vkutil
