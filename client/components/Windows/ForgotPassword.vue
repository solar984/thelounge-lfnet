<template>
	<div id="forgot-password" class="window" role="tabpanel" aria-label="Forgot password">
		<form class="container" method="post" action="" @submit="onSubmit">
			<img
				src="img/logo-vertical-transparent-bg.svg"
				class="logo"
				alt="The Lounge"
				width="256"
				height="170"
			/>
			<img
				src="img/logo-vertical-transparent-bg-inverted.svg"
				class="logo-inverted"
				alt="The Lounge"
				width="256"
				height="170"
			/>

			<label for="forgot-password-email">Email</label>
			<input
				id="forgot-password-email"
				v-model.trim="email"
				class="input"
				type="email"
				name="email"
				autocapitalize="none"
				autocorrect="off"
				autocomplete="email"
				required
				autofocus
			/>

			<div v-if="message" class="success">{{ message }}</div>

			<button :disabled="inFlight" type="submit" class="btn">Send reset link</button>
			<router-link class="link" :to="{name: 'SignIn'}">Back to sign in</router-link>
		</form>
	</div>
</template>

<script lang="ts">
import {defineComponent, ref} from "vue";

export default defineComponent({
	name: "ForgotPassword",
	setup() {
		const inFlight = ref(false);
		const email = ref("");
		const message = ref("");

		const onSubmit = async (event: Event) => {
			event.preventDefault();

			if (!email.value) {
				return;
			}

			inFlight.value = true;

			try {
				await fetch("/auth/reset/request", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						email: email.value,
					}),
				});
			} catch {
				// no-op: keep the same generic message to prevent account probing
			}

			message.value = "If an account exists for this email, a reset link has been sent.";
			inFlight.value = false;
		};

		return {
			inFlight,
			email,
			message,
			onSubmit,
		};
	},
});
</script>

<style scoped>
.success {
	color: #2ecc40;
	margin-top: 1em;
	width: 100%;
}

.link {
	display: block;
	margin-top: 8px;
	text-align: center;
}
</style>
