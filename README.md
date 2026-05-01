## TermGrasp

当你在终端遇到问题时，只需选中并右键复制到剪切板，然后敲下 tg why，TermGrasp 就会自动调用大模型帮您分析问题

### 技术栈

语言: TypeScript / Node.js

### 快速开始

首先确保您的电脑上已安装了 git 与 Node.js

1. 克隆项目并安装依赖

``` Bash
git clone https://github.com/dogeggly/termgrasp.git
cd termgrasp
npm install
```

2. 配置环境变量

- 在项目根目录创建 .env 文件，并填入你的大模型 API Key（只支持 OpenAI 接口，以智谱为例）：

```
LLM_API_KEY=xxxxxxxxxxxxxxxx
LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4
LLM_MODEL=glm-4.5
```   

3. 挂载全局命令

```Bash
npm link
```

4. 编译 ts

```
npm run build
```
