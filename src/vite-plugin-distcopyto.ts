import { type PluginOption, } from "vite"
import { existsSync, mkdirSync } from 'fs';
import { copyFile } from 'fs/promises';
import path from 'path';
import _ from "lodash"
/**copyTo: "public" 到项目public目录|| viteDist+addstring */
export default (addstring: string, ms: number = 2000): PluginOption => {
    let isRun: boolean = true
    let viteDist = ""; // 存储 Vite 输出目录路径
    let copyTo = ""
    const name = 'vite-plugin-distcopyto'
    // 确保目标目录存在（异步创建）
    const throttledCopy = _.throttle(async (bundle: Record<string, any>) => {
        if (!isRun) return
        const copyPromises = Object.values(bundle).map(async (file) => {
            const src = path.join(viteDist, file.fileName);
            const to = path.join(copyTo, file.fileName);
            await copyFile(src, to);
            return `${src}=>(${existsSync(to) ? "覆盖" : "新建"})${to}`
        });
        const data = await Promise.all(copyPromises);
        console.log(name, data)
    }, ms);
    return {
        name,
        enforce: 'post',
        config(config, env) {
            isRun = env.command === "build"
            viteDist = path.resolve(config.root || process.cwd(), config.build?.outDir || 'dist');
            copyTo =addstring==="public"?path.resolve(config.root || process.cwd(),  'public'): viteDist + addstring
            mkdirSync(copyTo, { recursive: true });
            console.log({ name, viteDist, copyTo });
        },
        writeBundle(_, bundle) {
            if (!isRun) return
            throttledCopy(bundle)
        },
    };
}