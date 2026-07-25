import type { Plugin } from "vite"
/**rollupOptions.output.inlineDynamicImports=true适用 */
export default (): Plugin => {
    const name = 'vite_public_electronpreloadold'
    const cssSet = new Set<string>();
    const ccc: Plugin = {
        name,
        generateBundle(options, bundle) {
            Object.entries(bundle).forEach(([fileName, chunk]) => {
                if (chunk.type === 'asset' && fileName.endsWith(".css")) {
                    if (chunk.source instanceof Uint8Array) {
                        cssSet.add(new TextDecoder('utf-8').decode(chunk.source));
                    } else {
                        cssSet.add(chunk.source);
                    }
                    console.log({ name, fileName })
                    delete bundle[fileName]; // 删除原 CSS 资源，避免重复输出
                }
            })
            const cssCode = Array.from(cssSet).join('\n').replace(/`/g, '\\`')
            Object.entries(bundle).forEach(([fileName, chunk]) => {
                if (chunk.type !== 'chunk' || !chunk.code && !fileName.endsWith(".js")) {
                    return
                }
                const jsCode = chunk.code
                const markerIndex = jsCode.indexOf("const DOMContentLoaded");
                if (markerIndex === -1) return;
                console.log({ name, fileName })
                const styleCode = [
                    'const style = document.createElement("style");',
                    'if (!style.type) {style.type = "text/css"}',
                    `style.textContent = \`${cssCode}\`;`,
                    'document.head.appendChild(style);',
                ].join('\n')
                const debugIndex = jsCode.indexOf("//# sourceMappingURL")
                const config = [
                    jsCode.slice(0, markerIndex),
                    'document.addEventListener("DOMContentLoaded", function(){',
                    `(async () => {${styleCode}})();`,
                    "const parsedUrl = new URL(window.location.href);",
                    "if(parsedUrl.protocol != 'file:' && !parsedUrl.host.includes('localhost')) {"
                ];
                if (debugIndex == -1) {
                    config.push(`${jsCode.slice(markerIndex)}; }});`)
                } else {
                    config.push(`${jsCode.slice(markerIndex, debugIndex)};}});`)
                    config.push(jsCode.slice(debugIndex))
                }
                chunk.code = config.join("\n")//.replace(/\n/g, '\n  ').trim()

            })
        }
    }
    return ccc
}
