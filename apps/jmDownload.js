import plugin from '../../../lib/plugins/plugin.js'
import tjLogger from '../components/logger.js'
import config from '../components/config.js'
import {
  runCommand,
  imagesToPDF,
  getFileSizeInHumanReadableFormat,
} from '../model/utils.js'
import jmDownload from '../model/jmDownload.js'
import { _DataPath, pluginAuthor } from '../data/system/pluginConstants.js'
import common from '../../../lib/common/common.js'
import fs from 'fs'

export class jmDownloadApp extends plugin {
  constructor() {
    super({
      /** 功能名称 */
      name: '[TJ插件]JM下载',
      /** 功能描述 */
      dsc: 'JM下载',
      /** https://oicqjs.github.io/oicq/#events */
      event: 'message',
      /** 优先级，数字越小等级越高 */
      priority: 1000,
      rule: [
        {
          reg: '^#?(JM|jm|JMComic|jmcomic)(.*)$',
          fnc: 'jmDownload',
        },
      ],
    })
  }

  async jmDownload() {
    // 一些预检
    if (!config.getConfig().JMComic.enable) {
      await this.reply('JMComic 功能未启用', true)
      return
    }

    let id = this.e.msg.replace(/#|JM|jm|JMComic|jmcomic|：|:/g, '').trim()
    if (!id) {
      await this.reply('不带 ID 我怎么下嘛!', true)
      return
    }

    // 判断 ID 是否为纯数字
    if (!/^\d+$/.test(id)) {
      await this.reply('ID 只能是数字哦!', true)
      return
    }

    // 检查 JMComic 命令是否存在
    if (!jmDownload.commandExists) {
      tjLogger.info('JMComic 命令不存在, 任务终止')
      this.reply('JMComic 不存在, 请先安装', true)
      return
    }

    // 检查消息渠道是否为群聊或私聊
    if (!this.e.isGroup && !this.e.isPrivate) {
      await this.reply('不支持的消息来源, 请在群聊或私聊使用', true)
      return
    }

    // 去除 id 可能存在的开头的 0
    id = parseInt(id).toString()

    let msg = `准备下载 JMComic ID: ${id}`
    let jmPrepareMsg = await this.reply(msg, true)

    // 变量
    let command = ''
    let commandResult = {}
    let downloadPath = `${jmDownload.downloadPathPrefix}/${id}`
    let pdfPassword = config.getConfig().JMComic.pdfPassword
    const pdfPath = `${jmDownload.convertPathPrefix}/${id}${
      pdfPassword ? `_Password` : ''
    }.pdf`
    tjLogger.debug(`准备下载 JMComic ID: ${id}, qq=${this.e.user_id}, path=${downloadPath}, pdfPath=${pdfPath}, password=${pdfPassword}`)

    // 如果downloadPath存在, 说明有相同任务正在下载, 循环等待到目录不存在再继续
    while (fs.existsSync(downloadPath)) {
      await common.sleep(600)
      tjLogger.debug(`JMComic ID: ${id} 已有相同任务在下载, 等待 600ms...`)
    }
    // 开始下载
    tjLogger.info(`开始下载 JMComic ID: ${id}`)
    command = `jmcomic ${id} --option="${_DataPath}/JMComic/option.yml"`
    commandResult = await runCommand(command)

    // 下载完成, 撤回准备消息
    if (this.e.group) this.e.group.recallMsg(jmPrepareMsg.message_id)
    if (this.e.friend) this.e.friend.recallMsg(jmPrepareMsg.message_id)

    if (!commandResult.output) {
      // 运行出现错误
      await this.reply(
        `下载失败, 请检查 ID 是否正确. 错误信息: ${commandResult.err}`,
        true
      )
      return
    } else if (commandResult.output.includes('jmcomic.jm_exception')) {
      // 命令结果有 JMComic 的报错
      // 出错了, 取回 jmcomic 报错的内容
      const match = commandResult.output.match(
        /MissingAlbumPhotoException\('([^']+)/
      )
      if (match) {
        if (match[1]?.includes('请求的本子不存在'))
          match[1] = '此 ID 不存在或登录可见'
        tjLogger.info(`下载 JMComic ${id} 失败: ${match[1]}`)
        this.reply(
          `下载失败, 错误信息: \n${match[1].replace(/\\n/g, '\n').trim()}`,
          true
        )
      } else {
        tjLogger.info(`下载 JMComic ${id} 失败: 无法识别的错误`)
        let msg = await common.makeForwardMsg(
          this.e,
          [
            'JM 下载失败, 未识别的错误, 日志如下: ',
            commandResult.output.replace(/\\n/g, '\n').trim(),
            '请向机器人主人或插件开发者反馈此问题',
          ],
          'JM 下载失败'
        )
        await this.reply(msg, true)
        return
      }
    } else if (commandResult.output.includes('本子下载完成')) {
      // 下载成功
      let downloadSuccessMsg = await this.reply('下载成功, 准备转换...', true)
      // 先给目录重命名加上时间戳后缀防止同时重复下载冲突
      downloadPath += `_${Date.now()}`
      // 如果pdfPath存在, 则先删除
      if (fs.existsSync(pdfPath)) {
        fs.unlinkSync(pdfPath)
        tjLogger.info(`已清理 JMComic 临时文件: ${pdfPath}`)
      }
      // 开始将该路径中的图片合并成 PDF
      let convertResult = await imagesToPDF(
        downloadPath,
        pdfPath,
        `JMComic-${id}_Powered-By-${pluginAuthor}`,
        pdfPassword,
        {
          author: pluginAuthor,
          subject: `JMComic${id}`,
          keywords: ['JMComic', `JMComic${id}`, `jm${id}`],
        }
      )
      tjLogger.debug(`图片转 PDF 结果: ${convertResult}`)
      if (convertResult == pdfPath) {
        // 计算 PDF 文件大小
        const pdfSize = getFileSizeInHumanReadableFormat(pdfPath)
        // 转换成功删掉下载的图片
        tjLogger.debug(`清理 JMComic 临时文件: ${downloadPath}`)
        fs.rm(downloadPath, { recursive: true, force: true }, (err) => {
          if (err)
            tjLogger.warn(
              `删除下载的图片路径 ${downloadPath} 失败: ${err.message}`
            )
        })
        let prepareSendFileMsg = await this.reply(
          `转 PDF 成功, 文件大小 ${pdfSize}, 准备发送...`,
          true
        )
        if (this.e.isGroup) this.e.group.recallMsg(downloadSuccessMsg.message_id)
        if (this.e.isPrivate) this.e.private.recallMsg(downloadSuccessMsg.message_id)

        // 发送 PDF
        let sendPdfRet = await jmDownload.sendPdf(pdfPath, pdfSize, pdfPassword, this.e)
        if (sendPdfRet) { // 返回非空, 说明处理失败
          this.reply(`发送 PDF 操作失败: ${sendPdfRet}`)
        }
        if (this.e.isGroup) this.e.group.recallMsg(prepareSendFileMsg.message_id)
        if (this.e.isPrivate) this.e.private.recallMsg(prepareSendFileMsg.message_id)
      } else {
        this.reply(`图片转 PDF 失败, 错误信息: ${convertResult}`, true)
      }
    } else {
      // 这真的是未知错误了
      let msg = await common.makeForwardMsg(
        this.e,
        [
          'JM 下载失败, 未识别的错误, 日志如下: ',
          commandResult.output.replace(/\\n/g, '\n').trim(),
          '请向机器人主人或插件开发者反馈此问题',
        ],
        'JM 下载失败'
      )
      await this.reply(msg, true)
    }
  }
}

// 在插件加载时执行初始化
jmDownload.init()
