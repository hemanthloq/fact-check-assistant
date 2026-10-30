import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * transformers.js loads onnxruntime-node, which ships native .node binaries. Bundling those
   * through webpack breaks them, so they stay external and are required at runtime instead.
   */
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node", "sharp"],
  experimental: {
    // The embedding model is held in a module-level promise; keeping server actions and route
    // handlers on one instance is what makes the 20s model load a one-time cost.
    serverActions: { bodySizeLimit: "1mb" },
  },
};

export default nextConfig;
