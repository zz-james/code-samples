/**
* this is a es6 class which is part of the further app that brokers messages from the browser to the pi-top using web sockets
* developed over time between me and one other developer I include it to show the level of complexity of some of the 
* code I have written/read/maintained, within here you will see a lot of use of async code and error handling
*/

import EventEmitter from 'events';
import { CodeDirectory } from '../context/CodeDirectory';
import { CodeRunKeyEventType } from '../types/graphql-types';

import { reqTimeout } from './requestHelpers';
import { updateQueryString } from './queryString';
import { createFurtherLinkDNS } from '../services/furtherLink';

export const SUCCESS_EXIT_CODE = 0;
export const STOPPED_EXIT_CODE = -15;
export const subdomain = 'further-link.pi-top.com';
export const defaultPort = 8028;
export const statusUrl = 'status';
export const runUrl = 'run?pty=true';
export const versionUrl = 'version';
export const aptVersionUrl = 'version/apt';
export const uploadUrl = 'upload';

const pingInterval = 3_000;
const defaultTimeout = 20_000;
const uploadTimeout = 180_000;

export const sdkPackageName = 'python3-pitop';
export const sdkMinVersion = '0.25.0';
export const linkMinVersion = '5.3.3';
export const linkUploadVersion = '4.4.0';

export type OnKeyListenType = (key: string) => void;
export type OnKeyEventType = (key: string, event: CodeRunKeyEventType) => void;

export type NovncOptions = {
  enabled?: boolean;
  height?: number;
  width?: number;
};

export type StartOptions = {
  processId: string;
  runner: string;
  novncOptions?: NovncOptions;
  directoryName?: string;
  onStdout: (content: string) => void;
  onStderr: (content: string) => void;
  onVideo: (src: string) => void;
  onNovnc?: (port: number, path: string) => void;
  onStop: (data: { exitCode: number }) => void;
  code?: string;
  fileName?: string;
};

export type PtySize = { rows: number; cols: number };

export type UrlOptions = {
  protocol?: string;
  port?: number | null;
};

export class FurtherLinkServer {
  static ipBaseUrl(
    ip: string,
    { protocol = 'https', port = defaultPort } = {}
  ) {
    return FurtherLinkServer.hostBaseUrl(
      `${FurtherLinkServer.normaliseIp(ip).replace(/\./g, '-')}.${subdomain}`,
      { protocol, port }
    );
  }

  private static hostBaseUrl(
    host: string,
    { protocol = 'https', port = defaultPort }: UrlOptions
  ) {
    return `${protocol}://${host}${port ? `:${port}` : ''}`;
  }

  private static normaliseIp(ip: string) {
    if (ip === 'localhost') {
      return '127.0.0.1';
    }

    return ip;
  }

  private static furtherLinkDNSHost(ip: string) {
    return `${ip.replace(/\./g, '-')}.${subdomain}`;
  }

  userInput: string;

  isLocal: boolean;

  ip: string;

  host: string;

  port: number | null;

  httpBaseUrl: string;

  wsBaseUrl: string;

  needsDNS: boolean;

  constructor(
    userInput: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useSSL = (window as any).PT_SVC_ENV !== 'development'
  ) {
    this.userInput = userInput;

    const directConnections = ['cloud-demo', 'cloud'];
    const isDirectConnection = directConnections.includes(userInput);

    this.isLocal = !isDirectConnection;

    this.ip = FurtherLinkServer.normaliseIp(userInput);
    this.host = isDirectConnection
      ? `${this.ip}.${subdomain}`
      : FurtherLinkServer.furtherLinkDNSHost(this.ip);
    this.port = isDirectConnection ? null : defaultPort;
    this.needsDNS = !isDirectConnection;

    this.httpBaseUrl = `${FurtherLinkServer.hostBaseUrl(this.host, {
      protocol: useSSL ? 'https' : 'http',
      port: this.port,
    })}`;

    this.wsBaseUrl = `${FurtherLinkServer.hostBaseUrl(this.host, {
      protocol: useSSL ? 'wss' : 'ws',
      port: this.port,
    })}`;
  }

  novncUrl(port: number, path: string) {
    if (this.isLocal) {
      return `${FurtherLinkServer.ipBaseUrl(this.userInput, {
        port,
      })}/${path}`;
    }

    // on cloud servers novnc ports are mapped as part of the path, and an
    // extra query param is required to point the novnc FE to that path also
    const [mainPath, query] = path.split('?');
    const fullQuery = updateQueryString(query, { path: `${port}/websockify` });
    return `${this.httpBaseUrl}/${port}/${mainPath}?${fullQuery}`;
  }

  async configureDNS(): Promise<boolean> {
    if (!this.needsDNS) return false;

    try {
      const { isNew } = await createFurtherLinkDNS({
        body: { ip: this.ip },
      });

      if (isNew) {
        // give a few seconds for dns propagation
        return new Promise((resolve) => {
          setTimeout(() => resolve(true), 5000);
        });
      }
      // eslint-disable-next-line no-empty
    } catch (e) {} // if DNS creation fails, still try to connect

    return false;
  }
}

export class FurtherLinkProcess {
  id: string;

  onStdout?: (content: string) => void;

  onStderr?: (content: string) => void;

  onStop?: (data: { exitCode: number }) => void;

  onVideo?: (src: string) => void;

  onNovnc?: (port: number, path: string) => void;

  keyListens: string[];

  onKeyListen?: OnKeyListenType;

  onKeyEvent?: OnKeyEventType;

  constructor(id: string) {
    this.id = id;
    this.keyListens = [];
  }

  resetKeyListens() {
    this.keyListens = [];
  }

  keyListen(key: string) {
    this.keyListens.push(key);
  }
}

export default class FurtherLink {
  private static createMessage(type: string, data = {}, process = '') {
    return JSON.stringify({ process, type, data });
  }

  private static parseMessage(message: string) {
    try {
      let { process, type, data } = JSON.parse(message);
      if (typeof process !== 'string') process = '';
      if (typeof type !== 'string') type = '';
      if (typeof data !== 'object') data = {};
      return { process, type, data };
    } catch (e) {
      return { process: '', type: '', data: {} };
    }
  }

  timeout: number;

  noPingPong: boolean;

  emitter: EventEmitter.EventEmitter;

  processes: Record<string, FurtherLinkProcess | undefined>;

  socket: WebSocket | null;

  server?: FurtherLinkServer;

  onError?: (e: Error) => void;

  onDisconnect?: () => void;

  pingTimeout?: number;

  constructor({ noPingPong = false, timeout = defaultTimeout } = {}) {
    this.timeout = timeout;
    this.noPingPong = noPingPong;

    this.emitter = new EventEmitter.EventEmitter();
    this.processes = {};
    this.socket = null;

    this.listenKeyEvents();
  }

  async connect(
    ip: string,
    onError: (e: Error) => void,
    onDisconnect: () => void
  ) {
    if (this.isReady()) {
      return Promise.resolve();
    }

    this.onError = onError;
    this.onDisconnect = onDisconnect;

    this.server = new FurtherLinkServer(ip);

    let timeout: number;
    let hasCancelled = false;

    return new Promise<boolean>(async (resolve, reject) => {
      try {
        this.emitter.once('cancelConnect', () => {
          if (timeout) clearTimeout(timeout);
          hasCancelled = true;
          this.onSocketDisconnect();
          resolve(false); // not an error but not connected
        });

        if (!this.server) return reject(new Error('Unknown server'));

        await this.server.configureDNS();

        if (hasCancelled) {
          return;
        }

        const wsUri = `${this.server.wsBaseUrl}/${runUrl}`;
        this.socket = new WebSocket(wsUri);

        // reject if there is an error before connection established
        this.socket.onerror = reject;

        this.socket.onmessage = (m) => this.handleMessage(m);
        this.socket.onclose = () => this.onSocketDisconnect();

        timeout = window.setTimeout(
          () => reject(new Error('Connect timeout')),
          this.timeout
        );

        this.socket.onopen = () => {
          this.onSocketOpen();
          clearTimeout(timeout);
          resolve(true);
        };
      } catch (e) {
        reject(e);
      }
    });
  }

  cancelConnect() {
    this.emitter.emit('cancelConnect');
    this.disconnect();
  }

  addProcess(processId: string) {
    const process = new FurtherLinkProcess(processId);
    this.processes[processId] = process;
    return process;
  }

  async checkVersion() {
    if (!this.server) throw new Error('Unknown server');

    const url = `${this.server.httpBaseUrl}/${versionUrl}`;
    const res = await reqTimeout(url, this.timeout);
    return res.json();
  }

  async checkPackageVersion(pkg: string) {
    if (!this.server) throw new Error('Unknown server');

    const url = `${this.server.httpBaseUrl}/${aptVersionUrl}/${pkg}`;
    const res = await reqTimeout(url, this.timeout);
    return res.json();
  }

  disconnect() {
    if (this.socket) {
      this.socket.onerror = null;
      this.socket.close(1000); // this should trigger onSocketDisconnect
      this.socket = null;
    }
  }

  async start(options: StartOptions): Promise<FurtherLinkProcess> {
    if (!this.isReady()) {
      return Promise.reject();
    }

    const {
      processId,
      runner,
      directoryName,
      code,
      fileName,
      novncOptions,
    } = options;

    const process = this.addProcess(options.processId);
    process.onStdout = options.onStdout;
    process.onStderr = options.onStderr;
    process.onVideo = options.onVideo;
    process.onNovnc = options.onNovnc;
    process.onStop = options.onStop;
    process.onKeyEvent = (key, event) =>
      this.send(
        FurtherLink.createMessage('keyevent', { key, event }, processId)
      );

    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error('Start timeout')),
        this.timeout
      );

      this.emitter.once('started', () => {
        clearTimeout(timeout);
        resolve(process);
      });

      this.send(
        FurtherLink.createMessage(
          'start',
          {
            runner,
            code,
            path: fileName ? `${directoryName}/${fileName}` : directoryName,
            novncOptions,
          },
          processId
        )
      );
    });
  }

  async upload(directory: CodeDirectory) {
    if (!this.server) throw new Error('Unknown server');

    const url = `${this.server.httpBaseUrl}/${uploadUrl}`;

    return reqTimeout(url, uploadTimeout, {
      method: 'POST',
      body: JSON.stringify(directory),
    });
  }

  async stop(processId: string) {
    if (!this.isReady()) {
      return Promise.reject();
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new Promise<any | Error>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error('Stop timeout')),
        this.timeout
      );

      this.emitter.once('stopped', (data) => {
        clearTimeout(timeout);
        resolve(data);
      });

      this.send(FurtherLink.createMessage('stop', {}, processId));
    });
  }

  sendInput(input: string, processId: string) {
    this.send(
      FurtherLink.createMessage(
        'stdin',
        {
          input,
        },
        processId
      )
    );
  }

  sendResize(size: PtySize, processId: string) {
    this.send(FurtherLink.createMessage('resize', size, processId));
  }

  private isReady() {
    return this.socket && this.socket.readyState === 1;
  }

  private onSocketOpen() {
    if (this.socket) {
      // once socket is opened, errors should go to the callback
      this.socket.onerror = () => {
        if (typeof this.onError === 'function') {
          // websocket 'error' is an event so we need to create our own Error
          this.onError(new Error('The connection was unexpectedly closed'));
        }
        this.onSocketDisconnect();
      };
    }

    this.startPingPong();
  }

  private onSocketDisconnect() {
    if (this.socket) {
      this.socket = null;
    }
    this.closePingPong();
    this.emitter.removeAllListeners();
    this.processes = {};
    this.server = undefined;
    this.onError = undefined;

    if (typeof this.onDisconnect === 'function') {
      this.onDisconnect();
      this.onDisconnect = undefined;
    }
  }

  private closePingPong() {
    if (this.pingTimeout) {
      clearTimeout(this.pingTimeout);
    }
  }

  private startPingPong() {
    if (!this.isReady() || this.noPingPong) {
      return false;
    }

    this.emitter.on('pong', () => {
      // send a ping pingInterval after they're done ponging
      clearTimeout(this.pingTimeout);
      this.pingTimeout = window.setTimeout(
        () => this.send(FurtherLink.createMessage('ping')),
        pingInterval
      );
    });

    return this.send(FurtherLink.createMessage('ping'));
  }

  private send(msg: string) {
    if (this.isReady()) this.socket?.send(msg);
  }

  private listenKeyEvents() {
    const handleKeyEvent = (event: CodeRunKeyEventType) => ({
      key,
    }: {
      key: string;
    }) => {
      Object.values(this.processes).forEach((process) => {
        if (
          process?.keyListens.includes(key) &&
          typeof process.onKeyEvent === 'function'
        ) {
          process.onKeyEvent(key, CodeRunKeyEventType[event]);
        }
      });
    };

    document.addEventListener(
      'keydown',
      handleKeyEvent(CodeRunKeyEventType.keydown)
    );
    document.addEventListener(
      'keyup',
      handleKeyEvent(CodeRunKeyEventType.keyup)
    );
  }

  private handleMessage(message: { data: string }) {
    const { process: processId, type, data } = FurtherLink.parseMessage(
      message.data
    );
    const process = this.processes[processId];

    switch (type) {
      case 'error':
        if (typeof this.onError === 'function') {
          this.onError(data);
        }
        break;
      case 'started':
        this.emitter.emit('started', { processId });
        break;
      case 'pong':
        this.emitter.emit('pong');
        break;
      // the following callbacks are bound in start() method
      case 'stdout':
        if (process?.onStdout) {
          process.onStdout(data.output);
        }
        break;
      case 'stderr':
        if (process?.onStderr) {
          process.onStderr(data.output);
        }
        break;
      case 'video':
        if (process?.onVideo) {
          process.onVideo(data.output);
        }
        break;
      case 'novnc':
        if (process?.onNovnc) {
          process.onNovnc(data.port, data.path);
        }
        break;
      case 'keylisten':
        if (process?.onKeyListen) {
          process.onKeyListen(data.output);
        }
        process?.keyListen(data.output);
        break;
      case 'stopped':
        this.emitter.emit('stopped', { processId, ...data });
        process?.resetKeyListens();
        if (process?.onStop) {
          process.onStop(data);
        }
        break;
      default:
        break;
    }
  }
}
