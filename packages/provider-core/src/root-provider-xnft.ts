import type { Event, XnftMetadata } from "@coral-xyz/common";
import {
  getLogger,
  CHANNEL_SOLANA_CONNECTION_INJECTED_REQUEST,
  CHANNEL_SOLANA_CONNECTION_INJECTED_RESPONSE,
  CHANNEL_PLUGIN_NOTIFICATION,
  PLUGIN_NOTIFICATION_CONNECT,
  PLUGIN_NOTIFICATION_MOUNT,
  PLUGIN_NOTIFICATION_UNMOUNT,
  PLUGIN_RPC_METHOD_LOCAL_STORAGE_GET,
  PLUGIN_RPC_METHOD_LOCAL_STORAGE_PUT,
  PLUGIN_RPC_METHOD_WINDOW_OPEN,
  PLUGIN_NOTIFICATION_UPDATE_METADATA,
  Blockchain,
  PLUGIN_NOTIFICATION_SOLANA_PUBLIC_KEY_UPDATED,
  PLUGIN_NOTIFICATION_ETHEREUM_PUBLIC_KEY_UPDATED,
} from "@coral-xyz/common";
import { RequestManager } from "./request-manager";
import { PrivateEventEmitter } from "./common/PrivateEventEmitter";

const logger = getLogger("provider-xnft-injection");

//
// Injected provider for UI plugins.
//
export class ProviderRootXnftInjection extends PrivateEventEmitter {
  #requestManager: RequestManager;
  #connectionRequestManager: RequestManager;
  #publicKeys: { [blockchain: string]: string };
  #connectionUrls: { [blockchain: string]: string | null };

  #childIframes: HTMLIFrameElement[];
  #cachedNotifications: { [notification: string]: Event };
  #metadata: XnftMetadata;

  constructor(
    requestManager: RequestManager,
    additionalProperties: { [key: string]: PrivateEventEmitter } = {}
  ) {
    super();
    const additionalPropertyConfig = {};
    Object.keys(additionalProperties).forEach((prop) => {
      additionalPropertyConfig[prop] = { value: additionalProperties[prop] };
    });
    Object.defineProperties(this, additionalPropertyConfig);
    if (new.target === ProviderRootXnftInjection) {
      Object.freeze(this);
    }
    this.#requestManager = requestManager;
    this.#connectionRequestManager = new RequestManager(
      CHANNEL_SOLANA_CONNECTION_INJECTED_REQUEST,
      CHANNEL_SOLANA_CONNECTION_INJECTED_RESPONSE
    );
    this.#childIframes = [];
    this.#cachedNotifications = {};
    this.#setupChannels();
  }

  public async getStorage<T = any>(key: string): Promise<T> {
    return await this.#requestManager.request({
      method: PLUGIN_RPC_METHOD_LOCAL_STORAGE_GET,
      params: [key],
    });
  }

  public async setStorage<T = any>(key: string, val: T): Promise<void> {
    await this.#requestManager.request({
      method: PLUGIN_RPC_METHOD_LOCAL_STORAGE_PUT,
      params: [key, val],
    });
  }

  public async openWindow(url: string) {
    await this.#requestManager.request({
      method: PLUGIN_RPC_METHOD_WINDOW_OPEN,
      params: [url],
    });
  }

  public async addIframe(iframeEl) {
    // Send across mount and connect notification to child iframes
    if (this.#cachedNotifications[PLUGIN_NOTIFICATION_MOUNT]) {
      iframeEl.contentWindow?.postMessage(
        this.#cachedNotifications[PLUGIN_NOTIFICATION_MOUNT],
        "*"
      );
    }

    if (this.#cachedNotifications[PLUGIN_NOTIFICATION_CONNECT]) {
      iframeEl.contentWindow?.postMessage(
        this.#cachedNotifications[PLUGIN_NOTIFICATION_CONNECT],
        "*"
      );
    }

    this.#childIframes.push(iframeEl);
  }

  public async removeIframe(iframeEl) {
    // @ts-ignore
    this.#childIframes = this.#childIframes.filter((x) => x !== iframeEl);
  }

  #setupChannels() {
    window.addEventListener("message", this.#handleNotifications.bind(this));
  }

  //
  // Notifications from the extension UI -> plugin.
  //
  async #handleNotifications(event: Event) {
    if (event.data.type !== CHANNEL_PLUGIN_NOTIFICATION) return;

    // Send RPC message to all child iframes
    this.#childIframes.forEach((iframe) => {
      iframe.contentWindow?.postMessage(event, "*");
    });

    logger.debug("handle notification", event);

    const { name } = event.data.detail;
    this.#cachedNotifications[name] = event.data;
    switch (name) {
      case PLUGIN_NOTIFICATION_CONNECT:
        this.#handleConnect(event);
        break;
      case PLUGIN_NOTIFICATION_MOUNT:
        this.#handleMount(event);
        break;
      case PLUGIN_NOTIFICATION_UPDATE_METADATA:
        this.#handleUpdateMetadata(event);
        break;
      case PLUGIN_NOTIFICATION_UNMOUNT:
        this.#handleUnmount(event);
        break;
      case PLUGIN_NOTIFICATION_SOLANA_PUBLIC_KEY_UPDATED:
        this.#handleSolanaPublicKeyUpdated(event);
        break;
      case PLUGIN_NOTIFICATION_ETHEREUM_PUBLIC_KEY_UPDATED:
        this.#handleEthereumPublicKeyUpdated(event);
      default:
        console.error(event);
        throw new Error("invalid notification");
    }
  }

  #handleSolanaPublicKeyUpdated(event) {
    const publicKey = event.data.detail.data.publicKey;
    this.#publicKeys[Blockchain.SOLANA] = publicKey;
    this.emit("publicKeysUpdate", this.#publicKeys);
  }

  #handleEthereumPublicKeyUpdated(event) {
    const publicKey = event.data.detail.data.publicKey;
    this.#publicKeys[Blockchain.ETHEREUM] = publicKey;
    this.emit("publicKeysUpdate", this.#publicKeys);
  }

  #handleConnect(event: Event) {
    this.#publicKeys = event.data.detail.publicKeys;
    this.#connectionUrls = event.data.detail.connectionUrls;

    this.emit("connect", event.data.detail);
  }

  #handleMount(event: Event) {
    this.emit("mount", event.data.detail);
  }

  #handleUpdateMetadata(event: Event) {
    this.#metadata = event.data.detail.data.metadata;
    this.emit("metadata", event.data.detail);
  }

  #handleUnmount(event: Event) {
    this.emit("unmount", event.data.detail);
  }

  public freeze() {
    return Object.freeze(this);
  }

  public get publicKeys() {
    return this.#publicKeys;
  }

  public get connectionUrls() {
    return this.#connectionUrls;
  }

  public get metadata() {
    return this.#metadata;
  }
}
