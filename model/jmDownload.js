import tjLogger from '../components/logger.js'
import config from '../components/config.js'
import { runCommand } from './utils.js'
import httpServer from './httpServer.js'
import { _DataPath } from '../data/system/pluginConstants.js'
import fs from 'fs'

export default class jmDownload {
  static commandExists = false
  static downloadPathPrefix = `${_DataPath}/JMComic/cache/download`
  static convertPathPrefix = `${_DataPath}/JMComic/cache/convert`

  /**
   * 初始化服务
   */
  static async init() {
    await this.checkCommand()
    await this.cleanTempFiles()
  }

  /**
   * 检查命令是否存在
   */
  static async checkCommand() {
    tjLogger.debug('开始检查 JMComic 命令是否存在')
    let commandResult = await runCommand('jmcomic')
    if (!commandResult.output) {
      this.commandExists = false
      tjLogger.error('JMComic 命令不存在, JM 下载功能将不可用, 请先按照教程安装 JMComic 并重启 Bot')
    } else {
      this.commandExists = true
      tjLogger.info('JMComic 命令存在, JM 下载功能可用')
    }
  }

  /**
   * 清理所有 JMComic 临时文件
   */
  static async cleanTempFiles() {
    try {
      // 清理下载目录内的所有子目录
      if (fs.existsSync(this.downloadPathPrefix)) {
        const downloadDirs = fs.readdirSync(this.downloadPathPrefix)
        for (const dir of downloadDirs) {
          const dirPath = `${this.downloadPathPrefix}/${dir}`
          if (fs.statSync(dirPath).isDirectory()) {
            fs.rmSync(dirPath, { recursive: true, force: true })
            tjLogger.info(`已清理 JMComic 临时文件: ${dirPath}`)
          }
        }
        tjLogger.debug('完成清理 JMComic 临时下载文件')
      }
      // 清理转换目录内的所有PDF文件
      if (fs.existsSync(this.convertPathPrefix)) {
        const convertFiles = fs.readdirSync(this.convertPathPrefix)
        for (const file of convertFiles) {
          if (file.endsWith('.pdf')) {
            fs.unlinkSync(`${this.convertPathPrefix}/${file}`)
            tjLogger.info(`已清理 JMComic 临时文件: ${file}`)
          }
        }
        tjLogger.debug('完成清理 JMComic 临时转换文件')
      }
    } catch (err) {
      tjLogger.warn(`清理 JMComic 临时文件出错: ${err.message}`)
    }
  }

  /**
   * 发送 PDF 或下载链接
   * @param {string} pdfPath 要发送的 PDF 目录
   * @param {string} pdSize 转换好的 PDF 大小
   * @param {string} pdfPassword PDF 密码
   * @param {object} e 消息对象
   * @return {Promise<void|string>} 处理成功(包括发送成功/发送失败)返回 void, 失败返回 string 原因
   */
  static async sendPdf(pdfPath, pdfSize, pdfPassword, e) {
    if (!e.isGroup && !e.isPrivate) return '未知消息来源, 请检查'
    let sendFileRet
    try {
      if (e.isGroup) sendFileRet = await e.group.fs.upload(pdfPath)
      else sendFileRet = await e.friend.sendFile(pdfPath)
    } catch (err) { // 发送文件出问题

      tjLogger.error(`发送文件失败: ${err.message}`)
      if (err.message == 'group space not enough')
        err.message = '群文件空间不足'
      else if (err.message.includes('send feed not all success'))
        // send feed not all success. failed_count=1 , 大概是协议问题
        err.message = '部分分片未发送成功'
      else if (err.message.includes('unknown highway error'))
        // 大概也是协议问题
        err.message = '未知通道错误'

      let msg = `文件发送失败, 错误信息: \n${err.message}`

      if (
        config.getConfig().httpServer.enable &&
        err.message != '群文件空间不足'
      ) { // 启用了 HTTP 服务器并且错误不是群文件空间不足的话, 尝试创建临时链接
        msg += `\n将尝试上传到内置服务器...`
        let msgId = await e.reply(msg, true)
        let tmpFileUrl = httpServer.createTmpFileUrl(pdfPath, 300)
        if (tmpFileUrl) {
          msg = `文件大小: ${pdfSize}\n${
            config.getConfig().JMComic.sendPdfPassword && pdfPassword
              ? `密码: ${pdfPassword}\n`
              : ''
          }点击链接下载: \n${tmpFileUrl}\n链接有效期约 5 分钟`
          e.group.recallMsg(msgId.message_id)
          e.reply(msg, true)
        }
      } else {
        e.reply(msg, true)
      }

      return
    }

    // 发送文件没报错
    tjLogger.debug(`发送文件结果: ${JSON.stringify(sendFileRet)}`)
    if (sendFileRet !== null && typeof sendFileRet == 'object') {
      // 返回了对象说明发送成功
      tjLogger.debug(`发送文件成功: ${pdfPath}`)
      fs.unlinkSync(pdfPath)
      tjLogger.debug(`已删除临时文件: ${pdfPath}`)
      if (
        config.getConfig().JMComic.sendPdfPassword &&
        pdfPassword
      ) {
        tjLogger.debug(`发送密码 ${pdfPassword}, pdfPath=${pdfPath}`)
        e.reply(`文件发送成功, 密码: ${pdfPassword}`)
      }
    } else if (sendFileRet !== null) {
      // 发送返回非空, 那就报下错吧
      e.reply(`发送文件出问题: ${sendFileRet}`)
    } else {
      // 发送返回空, 这啥情况
      e.reply(`发送文件出问题, 返回为空`)
    }

    return
  }
}
