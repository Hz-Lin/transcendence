<template>
	<div v-if="isReady">
		<div class="col-sm-9 col-sm-offset-3 col-md-10 col-md-offset-2 chatbox-dm">
			<div class="row">
				<div class="dm-header d-inline-flex">
					<div class="dm-avatar dm-header-item">
						<img :src="avatarPrefix + otherUserAvatar" class="avatar-pic-mini" alt="avatar">
					</div>
					<div class="dm-name dm-header-item flex-grow-1">
						<h3>{{ otherUserName }}</h3>
					</div>
					<div class="dm-dropdown dm-header-item">
						<i class="bi bi-sliders2 dropdown-toggle" data-bs-toggle="dropdown" aria-expanded="false"
							style="font-size: 2rem; color: #ffffff;"></i>
						<ul class="dropdown-menu">
							<li v-if="isActive"><a class="dropdown-item" href="#" @click="inviteToGame()">Invite
									to Game</a></li>
							<li><a class="dropdown-item" href="#" @click="leaveChannel()">Leave Channel</a>
							</li>
							<li><a class="dropdown-item" href="#">
									<RouterLink class="nav-link" :to="{ path: '/profile/other/' + otherUserIntraId }">
										View Profile</RouterLink>
								</a>
							</li>
						</ul>
					</div>
				</div>
			</div>

			<div class="dm-body" id="messageBody">
				<div class="msg-container" v-for="msg in allMessages" :key="msg.text">
					<div class="single-msg d-flex flex-column">
						<div class="msg-userinfo d-inline-flex">
							<img :src="avatarPrefix + msg.avatar" class="avatar-msg" alt="avatar">
							<h5 class="msg-username">{{ msg.name }}</h5>
						</div>
						<div v-if="!msg.isLink" class="msg-text">
							<p>{{ msg.text }}</p>
						</div>
						<div v-else-if="msg.isLink" class="msg-text">
							<p>Do you want to play a game? Click <a href="#" @click="navigateToLink(msg.text)">{{
								'here' }}</a> to join</p>
						</div>
					</div>
				</div>
			</div>

			<div class="dm-input">
				<div class="input-group mb-3">
					<label for="message"></label>
					<input type="text" id="message" class="form-control" placeholder="type in messages here"
						v-model="messageText" @keyup.enter="sendMessage()">
					<button class="btn btn-outline-secondary" type="button" id="button-msg"
						@click="sendMessage()">Send</button>
				</div>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import axios from "axios";
import { ref, defineProps, onMounted, onUnmounted, computed, onBeforeMount } from "vue";
import { Socket, io } from "socket.io-client";
import $ from "jquery";
import { useToast } from "primevue/usetoast";
import { ErrorType, errorMessage } from "@/types/ErrorType";
import type { Member, Message } from "../types/ChatType";
import { useRouter } from "vue-router";
import { HOST } from "@/constants/constants";

const props = defineProps({
	channelName: {
		type: String,
		required: true,
	},
});
const axiosInstance = axios.create({
	baseURL: `http://${HOST}:3001/chat`,
	withCredentials: true,
});
const router = useRouter();
const toast = useToast();
let socket: Socket;

const activeChannel = ref<string>('');
const activeChannelType = ref<string>('');
const allMessages = ref<Message[]>([]);
const member = ref<Member>();
const messageText = ref<string>('');
const allConnectedClients = ref<number[]>([]);
const otherUserAvatar = ref<string>('');
const otherUserName = ref<string>('');
const otherUserIntraId = ref<number>();
const avatarPrefix = ref(`http://${HOST}:3001/user/get_avatar?avatar=`);

onBeforeMount(async () => {
	socket = io(
		`http://${HOST}:3001/chat`, {
		withCredentials: true,
	}
	);
	activeChannel.value = props.channelName;
	activeChannelType.value = 'DM';
	await joinChannel();
})

onMounted(async () => {
	socket.on('joined', async (data) => {
		if (data === null || undefined) {
			toast.add({
				severity: "error",
				summary: "Error",
				detail: 'You are not a member of this channel',
				life: 3000,
			});
		}
		else {
			await getDMChannel();
			await loadAllMessages();
			const memberdata: Member = {
				intraId: data.user.intraId,
				name: data.user.name,
				avatar: data.user.avatar,
				role: data.role,
			};
			member.value = memberdata;
		}
	});

	socket.on('leaveChannel', () => {
		leaveChannel();
	})

	socket.on('left', () => {
		socket.disconnect();
		router.push({
			name: 'Chat',
		});
	})

	socket.on('userJoined', (data) => {
		allConnectedClients.value.push(data.user.intraId);
	})

	socket.on('userLeft', (data) => {
		const index = allConnectedClients.value.findIndex((intraId) => intraId === data.user.intraId);
		if (index !== -1) {
			allConnectedClients.value.splice(index, 1);
		}
	})

	socket.on('otherJoinedMembers', (data) => {
		const allIntraIds: number[] = data.map((item: any) => item.intraId);
		allConnectedClients.value = allIntraIds;
	});

	socket.on('message', (data) => {
		allMessages.value.push(data);
		$("#messageBody").animate({ scrollTop: 20000000 }, "slow");
	});

	socket.on('createGame', (data) => {
		const gameid = data;
		if (gameid === undefined || gameid === null) {
			toast.add({
				severity: "error",
				summary: "Error",
				detail: errorMessage(ErrorType.GENERAL),
				life: 3000,
			});
			return;
		}
		router.push({
			name: 'Game',
			params: { gameid: gameid },
		});
	});

	socket.on('inviteForGame', (data) => {
		const gameid: string = data.gameId;
		if (gameid === undefined || gameid === null) {
			toast.add({
				severity: "error",
				summary: "Error",
				detail: errorMessage(ErrorType.GENERAL),
				life: 3000,
			});
			return;
		}
		const invite: Message = {
			channelName: '',
			intraId: data.user.intraId,
			name: data.user.name,
			avatar: data.user.avatar,
			text: gameid,
			isLink: true,
		}
		allMessages.value.push(invite);
	});
})

onUnmounted(() => {
	socket.removeAllListeners();
	if (member.value) {
		leaveChannel();
	}
	$('.modal-backdrop').remove();
})

async function getDMChannel(): Promise<void> {
	try {
		const response = await axiosInstance.get("getMyDMChannelsWithUser");
		const channels = response.data;
		const thisDm = channels.find((channel: any) => {
			return channel.channel.channelName === props.channelName;
		});

		if (thisDm) {
			const otherUser = thisDm.otherUser;
			otherUserIntraId.value = otherUser.intraId;
			otherUserName.value = otherUser.name;
			otherUserAvatar.value = otherUser.avatar;
		} else {
			toast.add({
				severity: "error",
				summary: "Error",
				detail: 'DMChannel not found',
				life: 3000,
			});
		}
	} catch (error: any) {
		toast.add({
			severity: "error",
			summary: "Error",
			detail: "Failed retrieving DMChannel information",
			life: 3000,
		});
	}
};

async function joinChannel(): Promise<void> {
	if (socket.connected) {
		socket.emit('joinChannel', activeChannel.value);
	}
	else {
		socket.on('hasConnected', async () => {
			socket.emit('joinChannel', activeChannel.value);
		});
	}
};

async function loadAllMessages(): Promise<void> {
	const request = {
		channelName: activeChannel.value,
		channelType: activeChannelType.value,
	}
	try {
		const response = await axiosInstance.get('getAllMessagesInChannel', { params: request });
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

const isActive = computed(() => {
	return allConnectedClients.value.some((intraId: number) => intraId === otherUserIntraId.value);
});

const isReady = computed(() => {
	return !!member.value;
});

function inviteToGame(): void {
	const data = {
		channelName: activeChannel.value,
		otherIntraId: otherUserIntraId,
	}
	socket.emit('gameChallenge', data);
}

function navigateToLink(gameid: string) {
	router.push({
		name: 'Game',
		params: { gameid: gameid },
	});
}

function leaveChannel(): void {
	socket.emit('leaveChannel', activeChannel.value);
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

.dm-header {
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