(() => {
  const base = "https://www.hfsyapi.cn";
  const common = {
    protocol: "hfsy-task-catalog",
    base,
    generatePath: "/v1/image/create",
    queryPath: "/v1/image/query/{task_id}",
    queryMethod: "GET",
    mode: "async",
    inputMode: "reference",
    taskIdPaths: "id,task_id,data.task_id",
    statusPaths: "status,data.status,task_status,data.task_status",
    resultPaths: "images[0].url,data.images[0].url,data[0].url,result_url,data.result_url,output[0].url,images[0].b64_json,data[0].b64_json",
    successStates: "COMPLETED,SUCCESS,SUCCEEDED,DONE,FINISHED",
    failureStates: "FAILURE,FAILED,ERROR,CANCELLED",
    promptMaxLength: 5000,
    defaultSize: "1024x1024"
  };
  const entry = (id, name, maxReferenceImages, sizes, note, extra = {}) => ({
    ...common,
    id,
    name,
    model: id,
    maxReferenceImages,
    sizes,
    note,
    ...extra
  });
  window.MODEL_CATALOG = [
    entry("nano-banana-pro", "Nano Banana Pro", 7, ["1K", "2K", "4K"], "提示词最多 5000 字；单任务参考图最多 7 张。"),
    entry("nano-banana-2", "Nano Banana 2", 4, ["1K", "2K", "4K"], "提示词最多 5000 字；单任务参考图最多 4 张。"),
    entry("gemini-3.1-flash-image-preview", "Gemini 3.1 Flash Image Preview", 4, ["1K", "2K", "4K"], "文档示例模型名存在不一致，已按文件标题和创建请求模型 ID 配置。"),
    entry("gemini-3-pro-image-preview", "Gemini 3 Pro Image Preview", 7, ["1K", "2K", "4K"], "提示词最多 5000 字；单任务参考图最多 7 张。"),
    entry("gpt-image-2pro-4k", "GPT Image 2 Pro 4K", 4, ["2K", "4K"], "支持 2K、4K 尺寸（如 2048x2048 / 4096x4096）；单任务参考图最多 4 张。", { defaultSize: "2048x2048" }),
    entry("gpt-image-2pro", "GPT Image 2 Pro", 4, ["2K"], "支持 2K 尺寸（如 2048x2048）；单任务参考图最多 4 张。", { defaultSize: "2048x2048" }),
    entry("gpt-image-2.5", "GPT Image 2.5", 6, ["1K"], "支持 1K 尺寸（如 1024x1024）；单任务参考图最多 6 张。"),
    entry("gpt-image-2", "GPT Image 2", 6, ["1K"], "支持 1K 尺寸（如 1024x1024）；单任务参考图最多 6 张。"),
    entry("gpt-image-2.5-sunburst", "GPT Image 2.5 Sunburst", 16, ["1K", "2K", "4K"], "最多 16 张参考图、总大小不超过 25 MB。", { maxReferenceBytes: 25 * 1024 * 1024 }),
    entry("gpt-image-2.5-flare", "GPT Image 2.5 Flare", 16, ["1K", "2K", "4K"], "最多 16 张参考图、总大小不超过 25 MB。", { maxReferenceBytes: 25 * 1024 * 1024 })
  ];
})();
