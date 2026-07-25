import type { Plugin } from 'vite';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
type ViteCLICmdArgs =
  // 带字符串参数的选项
  | `--host ${string}`
  | `--port ${number}`
  | `--open ${boolean | string}`
  | `--config ${string}` | `-c ${string}`
  | `--base ${string}`
  | `--logLevel ${'info' | 'warn' | 'error' | 'silent'}` | `-l ${'info' | 'warn' | 'error' | 'silent'}`
  | `--configLoader ${'bundle' | 'runner'}`
  | `--debug ${boolean | string}` | `-d ${boolean | string}`
  | `--filter ${string}` | `-f ${string}`
  | `--mode ${string}` | `-m ${string}`
  // 布尔值开关选项（无参数）
  | '--cors'
  | '--strictPort'
  | '--force'
  | '--clearScreen'
  | '--profile'
  | '--help' | '-h'
  | '--version' | '-v';
type args_t = {
  host: string
  port: number
  strictPort: number
  open: boolean | string
  //config: string
  base: string
  logLevel: 'info' | 'warn' | 'error' | 'silent' | `-l ${'info' | 'warn' | 'error' | 'silent'}`
  configLoader: 'bundle' | 'runner'
  debug: `${boolean | string}` | `-d ${boolean | string}`
  filter: `${string}` | `-f ${string}`
  mode: `${string}` | `-m ${string}`
}
/**
 * 路径标准化工具：统一处理Windows/Linux路径符号
 * @param inputPath 原始路径
 * @returns 标准化后的绝对路径
 */
const normalizePath = (inputPath: string): string => {
  const unescapedPath = inputPath.replace(/\\/g, '/');
  const absolutePath = path.resolve(unescapedPath);
  return path.normalize(absolutePath);
};
export default <T extends Record<string, string>>({
  viteconfigFile,
  args ={},
  env
}: {
  viteconfigFile: `${string}.${"js" | "ts"}`; // 必填：vite配置文件路径（.js/.ts）
  env: T
  args?: Partial<args_t>
}): Plugin => {
  const name = 'vite_plugin_remotevite';
  let remoteProcess: ReturnType<typeof spawn> | null = null;
  const safeKillProcess = () => {
    if (remoteProcess && remoteProcess.exitCode === null) {
      try {
        remoteProcess.kill('SIGTERM');
        console.log(`[remoteVite] 子进程已发送终止信号`);
      } catch (err) {
        console.warn(`[remoteVite] 终止子进程失败:`, (err as Error).message);
      }
    }
    remoteProcess = null;
  };
  return {
    name,
    configResolved(config) {
      const json = normalizePath(viteconfigFile);
      if (!fs.existsSync(json)) {
        console.error(`配置文件不存在：${json}`);
        process.exit(1); // 直接退出，简单粗暴且有效
      }
      const cwd = path.dirname(json)
      const argshead = config.command === 'serve' ? ['vite',] : ['vite', 'build']
      const viteArgs = { configLoader: 'runner', ...args }
      const argv = [...argshead, `--config ${json}`, ...Object.entries(viteArgs).map(([k,v])=>`--${k} ${v.toString()}`)]
      //argv接收//process.argv[process.argv.findIndex(v => v === "--port") + 1]
      remoteProcess = spawn('pnpm', argv, {
        cwd,       // 切换到目标目录
        env: { ...process.env, ...env },
        stdio: 'inherit',     // 继承主进程输入输出
        shell: true,          // 兼容Windows
      });
      remoteProcess.on('exit', (code, signal) => {
        console.log(`子进程退出，码值: ${code}, 信号: ${signal}`);
        remoteProcess = null;
      });
      remoteProcess.stdout?.on('data', (data) => {
        console.log(`stdout ${data.toString().trim()}`);
      });
      remoteProcess.stderr?.on('data', (data) => {
        console.log(`stderr ${data.toString().trim()}`);
      });
      remoteProcess.on("message", (e) => {
        console.error(`error ${e}`);
      });
      remoteProcess.on('error', (err) => {
        console.error(`error ${err.message}`);
      });
      console.log({ name, args, cwd, env })
      process.on('exit', safeKillProcess).on('SIGINT', safeKillProcess); // 捕获Ctrl+C

    },
    closeBundle() {
      safeKillProcess();
    }
  };
};
