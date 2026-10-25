import type { Connector, PlatformDef } from '../../shared/types'
import { DingTalkConnector } from './dingtalk'
import { DiscordConnector } from './discord'
import { FeishuConnector } from './feishu'
import { IrcConnector } from './irc'
import { MatrixConnector } from './matrix'
import { OneBotConnector } from './onebot'
import { SlackConnector } from './slack'
import { TelegramConnector } from './telegram'
import { WhatsAppConnector } from './whatsapp'

/**
 * 平台定义 -> 连接器工厂。
 * - protocol='onebot' 的平台（QQ 及自定义桥接平台）统一走 OneBot 连接器
 * - 内置平台按 id 匹配；新增平台在这里注册或声明 protocol
 */
export function createConnector(def: PlatformDef): Connector | null {
  if (def.protocol === 'onebot') return new OneBotConnector()
  switch (def.id) {
    case 'telegram':
      return new TelegramConnector()
    case 'discord':
      return new DiscordConnector()
    case 'whatsapp':
      return new WhatsAppConnector()
    case 'feishu':
      return new FeishuConnector()
    case 'dingtalk':
      return new DingTalkConnector()
    case 'slack':
      return new SlackConnector()
    case 'matrix':
      return new MatrixConnector()
    case 'irc':
      return new IrcConnector()
    default:
      return null
  }
}
