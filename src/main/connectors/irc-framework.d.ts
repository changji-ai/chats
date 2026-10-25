/** irc-framework 未自带 TS 声明，这里只声明用到的最小接口 */
declare module 'irc-framework' {
  export interface ClientOptions {
    host: string
    port?: number
    nick: string
    tls?: boolean
    password?: string
    auto_reconnect?: boolean
    enable_chghost?: boolean
  }

  export class Client {
    constructor(options?: ClientOptions)
    connect(): void
    join(channel: string): void
    say(target: string, message: string): void
    quit(reason?: string): void
    end(): void
    on(event: string, listener: (...args: never[]) => void): void
    once(event: string, listener: (...args: never[]) => void): void
  }
}
