import React from 'react';
import Modal from '../../components/modal';
import {ChatCreateView} from './chat-create';
import Lang from '../../lang';

/**
 * 显示创建聊天对话框
 * @param {function} callback 显示完成后的回调函数
 * @return {void}
 */
const showCreateChatDialog = (callback) => {
    const modalId = 'app-chat-create-dialog';
    return Modal.show({
        id: modalId,
        title: Lang.string('chat.create.title'),
        style: {
            left: 10,
            right: 10,
            bottom: 0,
            top: 10
        },
        className: 'dock primary-pale',
        animation: 'enter-from-bottom',
        actions: false,
        content: <ChatCreateView onRequestClose={() => (Modal.hide(modalId))} />
    }, callback);
};

export default {
    show: showCreateChatDialog,
};
