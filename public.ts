/**
 * extends-vite 的公共插件入口。
 * 这里只汇总跨宿主可复用的 Vite 插件；宿主扩展的 manifest、CSP、发布和运行时拼装不放在这里。
 */
export { default as domContentLoaded } from "./vite_plugin_DOMContentLoaded.ts";
export { default as distCopyTo } from "./vite-plugin-distcopyto.ts";
export { default as remoteVite } from "./vite_plugin_remotevite.ts";
