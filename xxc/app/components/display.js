import React from 'react';
import ReactDOM from 'react-dom';
import DisplayContainer from './display-container';

/**
 * 弹出层管理组件 ID
 * @private
 * @type {String}
 */
const containerId = 'display-container';
/**
 * 弹出层管理组件渲染元素
 * @private
 * @type {Element}
 */
let container = document.getElementById(containerId);
if (!container) {
    container = document.createElement('div');
    container.id = containerId;
    container.classList.add('affix');
    document.body.appendChild(container);
}

/**
 * 用于存储弹出层管理组件实例
 * @type {DisplayContainer}
 * @private
 */
let displayContainer = null;
ReactDOM.render(<DisplayContainer ref={e => {displayContainer = e;}} />, container);

/**
 * 显示弹出层
 * @param {Object} props 弹出层初始化对象
 * @param {?Function} callback 操作完成后的回调函数
 * @return {DisplayLayer}
 * @export
 */
export const displayShow = (props, callback) => (displayContainer && displayContainer.show(props, callback));

/**
 * 隐藏指定 ID 的弹出层
 * @param {String} id 弹出层 ID
 * @param {?Function} callback 操作完成后的回调函数
 * @param {?Bool} remove 是否在隐藏后从界面上移除元素
 * @return {DisplayLayer}
 * @export
 */
export const displayHide = (id, callback, remove) => (displayContainer && displayContainer.hide(id, callback, remove));

/**
 * 隐藏并从界面上移除指定 ID 的弹出层
 * @param {String} id 弹出层 ID
 * @param {?Function} callback 操作完成后的回调函数
 * @return {DisplayLayer}
 * @export
 */
export const displayRemove = (id, callback) => (displayContainer && displayContainer.remove(id, callback));

/**
 * 获取指定 ID 的弹出层组件实例
 * @param {String} id 弹出层 ID
 * @return {DisplayLayer}
 * @export
 */
export const displayGetRef = id => {
    const item = displayContainer && displayContainer.getItem(id);
    return item && item.ref;
};

/**
 * 设置指定 ID 弹出层界面元素上的样式
 * @param {String} id 弹出层 ID
 * @param {Object} newStyle CSS 样式对象
 * @param {?Function} callback 操作完成后的回调函数
 * @return {DisplayLayer}
 * @export
 */
export const displaySetStyle = (id, newStyle, callback) => (displayContainer && displayContainer.setStyle(id, newStyle, callback));

/**
 * 到处所有可用方法
 * @type {object}
 * @export
 */
export default {
    show: displayShow,
    hide: displayHide,
    remove: displayRemove,
    getRef: displayGetRef,
    setStyle: displaySetStyle,
};
