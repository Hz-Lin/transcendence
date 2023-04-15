<template>
    <div class="create-channel-container">
		<form @submit.prevent="createChannel">
            <div class="mb-3 channel-name">
                <label for="channelName" class="form-label">Channel Name</label>
                <input type="text" class="form-control" id="channelName" v-model="channelName">
            </div>

            <div class="form-check form-check-inline channel-type">
                <input class="form-check-input" type="radio" name="inlineRadioOptions" id="type-public" value="PUBLIC" v-model="channelType">
                <label class="form-check-label" for="type-public">public</label>
            </div>
            <div class="form-check form-check-inline">
                <input class="form-check-input" type="radio" name="inlineRadioOptions" id="type-protected" value="PROTECTED" v-model="channelType">
                <label class="form-check-label" for="type-protected">protected</label>
            </div>
            <div class="form-check form-check-inline">
                <input class="form-check-input" type="radio" name="inlineRadioOptions" id="type-private" value="PRIVATE" v-model="channelType">
                <label class="form-check-label" for="type-private">private</label>
            </div>
            
            <div class="mb-3 channel-password" v-if="channelType === 'PROTECTED'">
                <label for="channelPassword" class="form-label">Channel Password</label>
                <input type="password" class="form-control" id="channelPassword" v-model="channelPassword" minlength="4" required placeholder="minimal 4 charaters">
            </div>

            <div class="submit-channel">
                <button type="submit" class="btn btn-outline-light" style="color:#ffffff; background-color: #09252f; border: 2px solid #ffffff;">Create Channel</button>
            </div>
		</form>
	</div>
</template>

<script setup lang="ts">
import axios from "axios";
import { ref, defineEmits } from "vue";
import { useToast } from "primevue/usetoast";
import { ErrorType, errorMessage } from "@/types/ErrorType";
import { ChannelMode } from "@/types/ChatType"

const toast = useToast();

const channelName = ref('');
const channelType = ref(ChannelMode.PUBLIC);
const channelPassword = ref('');

const emit = defineEmits<{
    (event: "isActionSuccess"): boolean;
}>();

function createChannel() {
    createRequestBody();
    console.log(requestBody);
    sendCreateChannelRequest();
}

let requestBody = {};
function createRequestBody() {
    if (channelPassword.value === '') {
        requestBody = {
            channelMode: channelType.value,
            channelName: channelName.value,
        }
    }
    else {
        requestBody = {
            channelMode: channelType.value,
            channelName: channelName.value,
            password: channelPassword.value,
        }  
    }
}

async function sendCreateChannelRequest() {
    await axios
        .post("http://localhost:3001/chat/createChannel", requestBody, {
            withCredentials: true,
        })
        .then(async (response) =>  {
            toast.add({
                severity: "success",
                summary: "Success",
                detail: "Created",
                life: 3000,
            });
            emit("isActionSuccess", true);
        })
        .catch(() => {
            toast.add({
                severity: "error",
                summary: "Error",
                detail: errorMessage(ErrorType.CREATE_CHANNEL_FAILED),
                life: 3000,
            });
            emit("isActionSuccess", false);
        });
};

</script>

<style scoped>
.create-channel-container{
    margin-left: 20px;
}

.channel-password {
    margin-top: 30px;
    margin-bottom: 30px;
}

.form-label {
    font-weight: bold;
    font-size: 30px;
}
.form-check-label{
    font-size: 20px;
}
.btn{
    margin-top: 30px;
    margin-bottom: 30px;
}
</style>