import { readFile, mkdir, writeFile } from 'node:fs/promises';
import JSZip from 'jszip';

const html = await readFile('dist-portable/index.html');
const favicon = await readFile('dist-portable/favicon.svg');
const document = `CurriculumFlow V1.1 · 便携离线版\n\n1. 解压全部文件。\n2. 用 Google Chrome 或 Microsoft Edge 双击打开 index.html。无需安装 Node.js、npm，也无需连接网络。\n3. 数据保存在当前浏览器的本地存储中。请不要把浏览器数据当作唯一副本，定期在项目页导出完整 ZIP 备份。\n4. 如果移动 index.html、换浏览器或清理浏览器数据，原来的本地项目可能无法显示。先在原位置导出备份，再在新位置使用“从备份恢复”。\n\n首次打开若浏览器限制了本地文件的存储权限，请使用 Chrome 或 Edge，并检查浏览器对本地文件的数据权限。\n`;
const zip = new JSZip();
zip.file('index.html', html);
zip.file('favicon.svg', favicon);
zip.file('启动说明.txt', document);
await mkdir('releases', { recursive: true });
const destination = 'releases/CurriculumFlow-Portable-1.1.0.zip';
await writeFile(destination, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } }));
console.log(`已生成 ${destination}`);
