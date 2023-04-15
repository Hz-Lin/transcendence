<template>
    <div class="col-sm-9 col-sm-offset-3 col-md-10 col-md-offset-2 chatbox-dm">
        <div class="row">
            <div class="dm-header d-inline-flex">
                <div class="dm-avatar dm-header-item">
                    <img src="../assets/logo_klein.png" class="avatar-pic-mini" alt="avatar">
                </div>
                <div class="dm-name dm-header-item flex-grow-1">
                    <h3>{{ props.channelName }}</h3>
                </div>
                <div class="dm-dropdown dm-header-item">
                    <i class="bi bi-sliders2 dropdown-toggle" data-bs-toggle="dropdown" aria-expanded="false" style="font-size: 2rem; color: #ffffff;"></i>
                    <ul class="dropdown-menu">
                        <li><a class="dropdown-item" href="#">Invite for Game</a></li>
                        <li><a class="dropdown-item" href="#">View Profile</a></li>
                    </ul>
                </div>
            </div>
        </div>

        <div class="dm-body" id="messageBody">
            <div class="msg-container" v-for="msg in allMessages" :key="msg.text">
                <div class="single-msg d-flex flex-column">
                    <div class="msg-userinfo d-inline-flex">
                        <!-- need dynamic -->
                        <img src="../assets/logo_klein.png" class="avatar-msg" alt="avatar">
                        <h5 class="msg-usernaem">{{ msg.name }}</h5>
                    </div>
                    <div class="msg-text">
                        <p>{{ msg.text }}</p>
                    </div>
                </div>
            </div>
        </div>

        <div class="dm-input">
            <div class="input-group mb-3">
                <input type="text" class="form-control" placeholder="type in messages here" v-model="messageText" @keyup.enter="sendMessage()" >
                <button class="btn btn-outline-secondary" type="button" id="button-msg" @click="sendMessage()">Send</button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import axios from "axios";
import { ref, defineProps, inject, onMounted, onUnmounted, onUpdated } from "vue";
import type { Socket } from "socket.io-client";
import $ from "jquery";
import { useToast } from "primevue/usetoast";
import { ErrorType, errorMessage } from "@/types/ErrorType";
import type { Messages } from "../types/ChatType";

const props = defineProps({
    channelName: String,
});

onMounted(async () => {
    await joinChannel(props.channelName);
    socket.on('message', (data) => {
		allMessages.value.push(data);
	});
    $("#messageBody").animate({ scrollTop: 20000000 }, "slow");
});

onUnmounted(() => {
  socket.off("joinChannel");
  socket.off("sendMessageToChannel");
  socket.off("message");
});

const toast = useToast();

const socket = inject("socketioInstance") as Socket;
const axiosInstance = axios.create({
	baseURL: 'http://localhost:3001',
	withCredentials: true,
});

const activeChannel = ref('');
const activeChannelType = ref('');

const allMessages = ref<Messages[]>([]);
const messageText = ref('');

async function joinChannel(channelName: string): Promise<void> {
    socket.emit('joinChannel', channelName);
    activeChannel.value = channelName;
    activeChannelType.value = 'DM';
    await loadAllMessages();
};

async function loadAllMessages(): Promise<void> {
    const request = {
        channelName: activeChannel.value,
        channelType: activeChannelType.value,
    }
    try {
		const response = await axiosInstance.get('chat/getAllMessagesInChannel', { params: request });
        allMessages.value = response.data;
	}
    catch (error: any) {
		toast.add({
            severity: "error",
            summary: "Error",
            detail: errorMessage(ErrorType.LOAD_MSG_FAILED),
            life: 3000,
        });
	}
};

async function sendMessage() {
    const messageData = {
        messageText: messageText.value,
		channelName: activeChannel.value,
    };
    try {
        socket.emit('sendMessageToChannel', messageData);
        messageText.value = '';
        $("#messageBody").animate({ scrollTop: 20000000 }, "slow");
    }
    catch (error: any) {
		toast.add({
            severity: "error",
            summary: "Error",
            detail: errorMessage(ErrorType.SEND_MSG_FAILED),
            life: 3000,
        });
	}
}

</script>

<style scoped>
.chatbox-dm {
    margin-left: 30px;
    margin-top: 10px;
    min-height: 760px;
    min-width: 500px;
}

.avatar-pic-mini {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    object-fit: cover;
}

h3 {
    margin-top: 5px;
    margin-bottom: 5px;
    margin-left: 10px;
    text-align: left;
}

.dm-header-item {
    margin-right: 10px;
}
.dm-header{
    border-bottom: #c8b8b8 2px solid;
}

.avatar-msg {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    object-fit: cover;
    margin-right: 10px;
}
.msg-usernaem {
    font-style: italic;
    color: #c8b8b8;
}
.msg-text {
    text-align: left;
    margin-left: 30px;
    font-size: 20px;
}
.single-msg {
    margin-top: 15px;
}

.dm-input {
    position: fixed;
    bottom: 0;
    width: 50%;
    min-width: 500px;
}
.dm-body {
    display: flex; 
    flex-direction: column;
    overflow: auto;
    max-height: 75vh;
}
</style>