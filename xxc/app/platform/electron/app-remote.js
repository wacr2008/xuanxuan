import electron, {
    BrowserWindow, app as ElectronApp, Tray, Menu, nativeImage, globalShortcut, ipcMain, dialog,
} from 'electron';
import Lang from '../../lang';
import EVENT from './remote-events';
import Events from './events';

if (typeof DEBUG === 'undefined') {
    global.DEBUG = process.env.NODE_ENV === 'debug' || process.env.NODE_ENV === 'development';
} else {
    global.DEBUG = DEBUG;
}

/**
 * 应用窗口索引
 * @type {number}
 * @private
 */
let appWindowIndex = 0;

/**
 * 是否是 Mac OS 系统
 * @type {boolean}
 * @private
 */
const IS_MAC_OSX = process.platform === 'darwin';

/**
 * 是否显示调试日志信息
 * @type {boolean}
 * @private
 */
const SHOW_LOG = DEBUG;

if (DEBUG && process.type === 'renderer') {
    console.error('AppRemote must run in main process.');
}

/**
 * 文本输入框右键菜单
 * @type {Menu}
 * @private
 */
const INPUT_MENU = Menu.buildFromTemplate([
    {role: 'undo', label: Lang.string('menu.undo')},
    {role: 'redo', label: Lang.string('menu.redo')},
    {type: 'separator'},
    {role: 'cut', label: Lang.string('menu.cut')},
    {role: 'copy', label: Lang.string('menu.copy')},
    {role: 'paste', label: Lang.string('menu.paste')},
    {type: 'separator'},
    {role: 'selectall', label: Lang.string('menu.selectAll')}
]);

/**
 * Electron 主进程运行时管理类
 *
 * @class AppRemote
 */
class AppRemote {
    /**
     * 创建一个主进程运行时管理类实例
     * @memberof AppRemote
     */
    constructor() {
        /**
         * 保存打开的所有窗口实例
         * @type {Object<string, BrowserWindow>}
         */
        this.windows = {};

        /**
         * 保存应用运行时配置
         * @type {Object}
         */
        this.appConfig = {};

        // 绑定渲染进程请求退出事件
        ipcMain.on(EVENT.app_quit, () => {
            this.quit();
        });

        // 绑定与渲染进程通信事件
        ipcMain.on(EVENT.remote, (e, method, callBackEventName, ...args) => {
            let result = this[method];
            if (typeof result === 'function') {
                result = result.call(this, ...args);
            }
            if (method === 'quit') return;
            if (result instanceof Promise) {
                result.then(x => {
                    e.sender.send(callBackEventName, x);
                    return x;
                }).catch(error => {
                    console.warn('Remote error', error);
                });
            } else {
                e.sender.send(callBackEventName, result);
            }
            if (DEBUG) {
                console.info('\n>> Accept remote call', `${callBackEventName}.${method}(`, args, ')');
            }
        });

        // 绑定渲染进程请求发送消息到其他窗口渲染进程事件
        ipcMain.on(EVENT.remote_send, (e, windowName, eventName, ...args) => {
            const browserWindow = this.windows[windowName];
            if (browserWindow) {
                browserWindow.webContents.send(eventName, ...args);
            }
        });

        // 绑定渲染进程请求绑定主进程事件
        ipcMain.on(EVENT.remote_on, (e, eventId, event) => {
            Events.on(event, (...args) => {
                try {
                    e.sender.send(eventId, ...args);
                } catch (_) {
                    this.off(eventId);
                    if (SHOW_LOG) {
                        console.error(`\n>> Remote event '${event}' has be force removed, because window is closed.`, e);
                    }
                }
            });
            // this._eventsMap[eventId] = {remote: true, id: remoteOnEventId};
            if (SHOW_LOG) console.log('\n>> REMOTE EVENT on', event, eventId);
        });

        // 绑定渲染进程请求取消绑定主进程事件
        ipcMain.on(EVENT.remote_off, (e, eventId) => {
            Events.off(eventId);
            if (SHOW_LOG) console.log('\n>> REMOTE EVENT off', eventId);
        });

        // 绑定渲染进程请求触发主进程事件
        ipcMain.on(EVENT.remote_emit, (e, eventId, ...args) => {
            Events.emit(eventId, ...args);
            if (SHOW_LOG) console.log('\n>> REMOTE EVENT emit', eventId);
        });

        // 绑定渲染进程通知准备就绪事件
        ipcMain.on(EVENT.app_ready, (e, config, windowName) => {
            Object.assign(this.appConfig, config);
            const langInConfig = config.lang && config.lang[Lang.name];
            if (langInConfig) {
                Lang.update(langInConfig);
            }
            this.createTrayIcon(windowName);
            if (SHOW_LOG) console.log('\n>> App ready.', config);
        });

        // 设置 Electron 应用标题
        ElectronApp.setName(Lang.string('app.title'));
    }

    // 初始化并设置 Electron 应用入口路径
    init(entryPath) {
        if (!entryPath) {
            throw new Error('Argument entryPath must be set on init app-remote.');
        }

        this.entryPath = entryPath;
        global.entryPath = entryPath;
    }

    /**
     * 通知主进程准备就绪并打开主界面窗口
     * @memberof AppRemote
     * @return {void}
     */
    ready() {
        this.openMainWindow();

        if (IS_MAC_OSX) {
            const dockMenu = Menu.buildFromTemplate([
                {
                    label: Lang.string('menu.createNewWindow'),
                    click: () => {
                        this.createAppWindow();
                    }
                }
            ]);
            ElectronApp.dock.setMenu(dockMenu);
        }
    }

    /**
     * 移除通知栏图标
     *
     * @param {string} windowName 窗口名称
     * @memberof AppRemote
     * @return {void}
     */
    removeTrayIcon(windowName) {
        if (this._traysData && this._traysData[windowName]) {
            const {tray} = this._traysData[windowName];
            if (tray) {
                tray.destroy();
            }
            delete this._traysData[windowName];
        }
    }

    /**
     * 初始化通知栏图标功能
     * @memberof AppRemote
     * @param {string} [windowName='main'] 窗口名称
     * @return {void}
     */
    createTrayIcon(windowName = 'main') {
        if (!this._traysData) {
            /**
             * 所有窗口中通知栏图标管理器数据
             * @type {Object[]}
             */
            this._traysData = {};
        }

        // 尝试移除旧的图标
        this.removeTrayIcon(windowName);

        // 创建一个通知栏图标
        const tray = new Tray(`${this.entryPath}/${this.appConfig.media['image.path']}tray-icon-16.png`);

        // 设置通知栏图标右键菜单功能
        const trayContextMenu = Menu.buildFromTemplate([
            {
                label: Lang.string('common.open'),
                click: () => {
                    this.showAndFocusWindow();
                }
            }, {
                label: Lang.string('common.exit'),
                click: () => {
                    this.windows[windowName].webContents.send(EVENT.remote_app_quit, 'quit');
                }
            }
        ]);

        // 设置通知栏图标鼠标提示
        tray.setToolTip(Lang.string('app.title'));

        // 绑定通知栏图标点击事件
        tray.on('click', () => {
            this.showAndFocusWindow(windowName);
        });

        // 绑定通知栏图标右键点击事件
        tray.on('right-click', () => {
            tray.popUpContextMenu(trayContextMenu);
        });

        this._traysData[windowName] = {
            /**
             * 通知栏图标管理器
             * @type {Tray}
             * @private
             */
            tray,

            /**
             * 通知栏图标闪烁计数器
             * @type {number}
             * @private
             */
            iconCounter: 0
        };

        /**
         * 通知栏图标图片缓存
         * @type {string[]}
         * @private
         */
        this._trayIcons = [
            nativeImage.createFromPath(`${this.entryPath}/${this.appConfig.media['image.path']}tray-icon-16.png`),
            nativeImage.createFromPath(`${this.entryPath}/${this.appConfig.media['image.path']}tray-icon-transparent.png`)
        ];
    }

    /**
     * 创建应用窗口
     *
     * @param {Object} options Electron 窗口初始化选项
     * @memberof AppRemote
     * @return {void}
     */
    createAppWindow(options) {
        const hasMainWindow = !!this.mainWindow;
        const windowName = hasMainWindow ? `main-${appWindowIndex++}` : 'main';
        options = Object.assign({
            width: 900,
            height: 650,
            minWidth: 400,
            minHeight: 650,
            url: `index.html?_name=${windowName}`,
            hashRoute: '/index',
            name: windowName,
            resizable: true,
            debug: true
        }, options);

        if (DEBUG && !hasMainWindow) {
            const display = electron.screen.getPrimaryDisplay();
            options.height = display.workAreaSize.height;
            options.width = 800;
            options.x = display.workArea.x;
            options.y = display.workArea.y;
        }

        const appWindow = this.createWindow(options);

        appWindow.on('close', e => {
            if (this.markClose && this.markClose[windowName]) return;
            const now = new Date().getTime();
            if (this.lastRequestCloseTime && (now - this.lastRequestCloseTime) < 1000) {
                electron.dialog.showMessageBox(appWindow, {
                    buttons: [Lang.string('common.exitIM'), Lang.string('common.cancel')],
                    defaultId: 0,
                    type: 'question',
                    message: Lang.string('common.comfirmQuiteIM')
                }, response => {
                    if (response === 0) {
                        setTimeout(() => {
                            this.closeWindow(windowName);
                        }, 0);
                    }
                });
            } else {
                this.lastRequestCloseTime = now;
                appWindow.webContents.send(EVENT.remote_app_quit);
            }
            e.preventDefault();
            return false;
        });

        // 绑定右键菜单事件
        appWindow.webContents.on('context-menu', (e, props) => {
            const {isEditable} = props;
            if (isEditable) {
                INPUT_MENU.popup(appWindow);
            }
        });

        if (!hasMainWindow) {
            /**
             * 主窗口实例
             * @type {BrowserWindow}
             */
            this.mainWindow = appWindow;
        }

        return windowName;
    }

    /**
     * 创建应用窗口，所有可用的窗口初始化选项参考 @see https://electronjs.org/docs/api/browser-window#new-browserwindowoptions
     * @param {string} name 窗口名称，用户内部查询窗口实例
     * @param {Object} options Electron 窗口初始化选项
     * @memberof AppRemote
     * @return {BrowserWindow} 创建的应用窗口实例
     */
    createWindow(name, options) {
        if (typeof name === 'object') {
            options = name;
            // eslint-disable-next-line prefer-destructuring
            name = options.name;
        }

        options = Object.assign({
            name,
            showAfterLoad: true,
            hashRoute: `/${name}`,
            url: 'index.html',
            autoHideMenuBar: !IS_MAC_OSX,
            backgroundColor: '#ffffff',
            show: DEBUG,
            webPreferences: {webSecurity: false}
        }, options);

        let browserWindow = this.windows[name];
        if (browserWindow) {
            throw new Error(`The window with name '${name}' has already be created.`);
        }

        const windowSetting = Object.assign({}, options);
        ['url', 'showAfterLoad', 'debug', 'hashRoute', 'onLoad', 'beforeShow', 'afterShow', 'onClosed'].forEach(optionName => {
            delete windowSetting[optionName];
        });
        browserWindow = new BrowserWindow(windowSetting);
        this.windows[name] = browserWindow;
        browserWindow.on('closed', () => {
            delete this.windows[name];
            if (options.onClosed) {
                options.onClosed(name);
            }
            this.tryQuiteOnAllWindowsClose();
        });

        browserWindow.webContents.on('did-finish-load', () => {
            if (options.showAfterLoad) {
                if (options.beforeShow) {
                    options.beforeShow(browserWindow, name);
                }
                browserWindow.show();
                browserWindow.focus();
                if (options.afterShow) {
                    options.afterShow(browserWindow, name);
                }
            }
            if (options.onLoad) {
                options.onLoad(browserWindow);
            }
        });

        // 阻止应用窗口导航到其他地址
        browserWindow.webContents.on('will-navigate', event => {
            event.preventDefault();
        });

        // 阻止应用内的链接打开新窗口
        browserWindow.webContents.on('new-window', (event, url) => {
            browserWindow.webContents.send(EVENT.open_url, url);
            event.preventDefault();
        });

        let {url} = options;
        if (url) {
            if (!url.startsWith('file://') && !url.startsWith('http://') && !url.startsWith('https://')) {
                url = `file://${this.entryPath}/${options.url}`;
            }
            if (DEBUG) {
                url += url.includes('?') ? '&react_perf' : '?react_perf';
            }
            if (options.hashRoute) {
                url += `#${options.hashRoute}`;
            }
            browserWindow.loadURL(url);
        }

        if (options.debug && DEBUG) {
            browserWindow.openDevTools();
            browserWindow.webContents.on('context-menu', (e, props) => {
                const {x, y} = props;
                Menu.buildFromTemplate([{
                    label: Lang.string('debug.inspectElement'),
                    click() {
                        browserWindow.inspectElement(x, y);
                    }
                }]).popup(browserWindow);
            });

            if (DEBUG) {
                browserWindow.webContents.on('crashed', () => {
                    const messageBoxOptions = {
                        type: 'info',
                        title: 'Renderer process crashed.',
                        message: 'The renderer process has been crashed, you can reload or close it.',
                        buttons: ['Reload', 'Close']
                    };
                    dialog.showMessageBox(messageBoxOptions, (index) => {
                        if (index === 0) {
                            browserWindow.reload();
                        } else {
                            browserWindow.close();
                        }
                    });
                });
            }
        }

        return browserWindow;
    }

    /**
     * 打开主窗口
     *
     * @memberof AppRemote
     * @return {void}
     */
    openMainWindow() {
        const {mainWindow} = this;
        if (!mainWindow) {
            this.createAppWindow();
        } else if (!mainWindow.isVisible()) {
            mainWindow.show();
            mainWindow.focus();
        }
    }

    /**
     * 获取主窗口实例
     * @memberof AppRemote
     * @type {BrowserWindow}
     */
    get mainWindow() {
        return this.windows.main;
    }

    /**
     * 设置主窗口实例
     * @param {BrowserWindow} mainWindow 主窗口实例
     * @memberof AppRemote
     */
    set mainWindow(mainWindow) {
        if (!mainWindow) {
            delete this.windows.main;
        } else {
            this.windows.main = mainWindow;
        }
    }

    /**
     * 关闭指定名称的窗口
     * @param {string} winName 窗口名称
     * @returns {boolean} 如果返回 `true` 则为关闭成功，否则为关闭失败（可能找不到指定名称的窗口）
     */
    closeWindow(winName) {
        // 移除窗口对应的通知栏图标
        this.removeTrayIcon(winName);

        // 获取已保存的窗口对象
        const win = this.windows[winName];
        if (SHOW_LOG) console.log('>> closeWindow', winName);
        if (win) {
            // 将窗口标记为关闭，跳过询问用户关闭策略步骤
            if (!this.markClose) {
                this.markClose = {};
            }
            this.markClose[winName] = true;
            win.close();
            return true;
        }
        return false;
    }

    /**
     * 尝试退出，如果所有窗口都被关闭
     *
     * @memberof AppRemote
     * @return {void}
     */
    tryQuiteOnAllWindowsClose() {
        let hasWindowOpen = false;
        Object.keys(this.windows).forEach(windowName => {
            if (!hasWindowOpen && this.windows[windowName] && !this.markClose[windowName]) {
                hasWindowOpen = true;
            }
        });
        if (SHOW_LOG) console.log('>> tryQuiteOnAllWindowsClose', hasWindowOpen);
        if (!hasWindowOpen) {
            this.quit();
        }
    }

    // /**
    //  * 关闭所有窗口
    //  * @return {void}
    //  */
    // closeAllWindows() {
    //     Object.keys(this.windows).forEach(winName => this.closeWindow(winName));
    // }

    /**
     * 获取当前激活的窗口
     * @memberof AppRemote
     * @type {BrowserWindow}
     */
    get currentFocusWindow() {
        const focusedWindowName = Object.keys(this.windows).find(winName => this.windows[winName].isFocused());
        return focusedWindowName ? this.windows[focusedWindowName] : (this.mainWindow || this.windows[Object.keys(this.windows)[0]]);
    }

    /**
     * 通过 IPC 向所有应用窗口渲染渲染进程发送消息
     *
     * @param {string} channel 事件频道
     * @param {...any} args 事件参数
     * @return {void}
     * @memberof AppRemote
     */
    sendToWindows(channel, ...args) {
        Object.keys(this.windows).forEach(name => {
            this.sendToWindow(name, channel, ...args);
        });
    }

    /**
     * 通过 IPC 向指定名称的应用窗口渲染渲染进程发送消息
     *
     * @param {string} name 应用窗口名称
     * @param {string} channel 事件频道
     * @param {...any} args 事件参数
     * @return {void}
     * @memberof AppRemote
     */
    sendToWindow(name, channel, ...args) {
        const browserWindow = this.windows[name];
        if (browserWindow) {
            browserWindow.webContents.send(channel, ...args);
        }
    }

    /**
     * 设置通知栏图标工具提示（鼠标悬停显示）消息
     *
     * @param {string|boolean} tooltip 要设置的消息文本，如果设置为 `false`，则显示应用默认名称
     * @param {string} [windowName='main'] 窗口名称
     * @memberof AppRemote
     * @return {void}
     */
    trayTooltip(tooltip, windowName = 'main') {
        this._traysData[windowName].tray.setToolTip(tooltip || Lang.string('app.title'));
    }

    /**
     * 闪烁通知栏图标
     *
     * @param {boolean} [flash=true] 如果设置为 `true` 则闪烁图标；如果设置为 `false` 则取消闪烁图标
     * @param {string} [windowName='main'] 窗口名称
     * @memberof AppRemote
     * @return {void}
     */
    flashTrayIcon(flash = true, windowName = 'main') {
        const trayData = this._traysData[windowName];
        if (flash) {
            if (!trayData.flashTask) {
                trayData.flashTask = setInterval(() => {
                    trayData.tray.setImage(this._trayIcons[(trayData.iconCounter++) % 2]);
                }, 400);
            }
        } else {
            if (trayData.flashTask) {
                clearInterval(trayData.flashTask);
                trayData.flashTask = null;
            }
            trayData.tray.setImage(this._trayIcons[0]);
        }
    }

    /**
     * 显示并激活指定名称的窗口，如果不指定名称，则激活并显示主窗口
     *
     * @param {string} [windowName='main'] 窗口名称
     * @memberof AppRemote
     * @return {void}
     */
    showAndFocusWindow(windowName = 'main') {
        const browserWindow = this.windows[windowName];
        if (browserWindow) {
            if (browserWindow.isMinimized()) {
                browserWindow.restore();
            } else {
                browserWindow.show();
            }
            browserWindow.focus();
        }
    }

    /**
     * 尝试询问用户是否要创建一个新窗口
     *
     * @memberof AppRemote
     * @return {void}
     */
    confirmCreateAppWindow() {
        this.showAndFocusWindow();
        electron.dialog.showMessageBox(this.currentFocusWindow, {
            buttons: [Lang.string('common.confirm'), Lang.string('common.cancel')],
            defaultId: 0,
            type: 'question',
            message: Lang.string('common.confirmCreateAppWindow')
        }, response => {
            if (response === 0) {
                this.createAppWindow();
            }
        });
    }

    /**
     * 立即关闭并退出应用程序
     *
     * @memberof AppRemote
     * @return {void}
     */
    // eslint-disable-next-line class-methods-use-this
    quit() {
        if (SHOW_LOG) console.log('>> quit');
        try {
            globalShortcut.unregisterAll();
        } catch (_) {}
        ElectronApp.quit();
    }

    /**
     * 设置 Mac Dock 栏应用图标上的圆点提示文本
     *
     * @param {string} label 提示文本
     * @memberof AppRemote
     * @return {void}
     */
    // eslint-disable-next-line class-methods-use-this
    dockBadgeLabel(label) {
        if (IS_MAC_OSX) {
            ElectronApp.dock.setBadge(label);
        }
    }

    /**
     * 使 Mac Dock 栏应用图标弹跳并引起用户注意
     *
     * @param {string} [type='informational'] Dock 栏应用图标弹跳类型
     * @memberof AppRemote
     * @return {void}
     */
    // eslint-disable-next-line class-methods-use-this
    dockBounce(type = 'informational') {
        if (IS_MAC_OSX) {
            ElectronApp.dock.bounce(type);
        }
    }
}

/**
 * Electron 主进程运行时管理类全局唯一实例
 * @type {AppRemote}
 */
const app = new AppRemote();

export default app;
