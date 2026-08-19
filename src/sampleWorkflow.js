export const sampleWorkflow = {
  "3": { class_type: "KSampler", _meta: { title: "KSampler" }, inputs: { seed: 47382910, steps: 28, cfg: 6.5, sampler_name: "euler", scheduler: "normal", denoise: 1, model: ["4", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0] } },
  "4": { class_type: "CheckpointLoaderSimple", _meta: { title: "Checkpoint loader" }, inputs: { ckpt_name: "juggernautXL_v9.safetensors" } },
  "5": { class_type: "EmptyLatentImage", _meta: { title: "Canvas size" }, inputs: { width: 1024, height: 1024, batch_size: 1 } },
  "6": { class_type: "CLIPTextEncode", _meta: { title: "Positive prompt" }, inputs: { text: "Cinematic portrait of an astronaut in a greenhouse, soft morning light, shallow depth of field, intricate details", clip: ["4", 1] } },
  "7": { class_type: "CLIPTextEncode", _meta: { title: "Negative prompt" }, inputs: { text: "blurry, low detail, distorted hands, text, watermark", clip: ["4", 1] } },
  "8": { class_type: "VAEDecode", _meta: { title: "VAE decode" }, inputs: { samples: ["3", 0], vae: ["4", 2] } },
  "9": { class_type: "SaveImage", _meta: { title: "Save image" }, inputs: { filename_prefix: "ComfyDeck", images: ["8", 0] } }
};
