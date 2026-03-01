<template>
	<div id="reset-password" class="window" role="tabpanel" aria-label="Reset password">
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

			<div v-if="showResetForm" class="password-container">
				<label for="reset-password-input">New password</label>
				<RevealPassword v-slot:default="slotProps">
					<input
						id="reset-password-input"
						v-model="password"
						:type="slotProps.isVisible ? 'text' : 'password'"
						class="input"
						autocapitalize="none"
						autocorrect="off"
						autocomplete="new-password"
						minlength="8"
						:disabled="Boolean(successMessage)"
						required
						autofocus
					/>
				</RevealPassword>
			</div>

			<div v-if="showResetForm" class="password-container">
				<label for="reset-password-confirm">Confirm password</label>
				<RevealPassword v-slot:default="slotProps">
					<input
						id="reset-password-confirm"
						v-model="passwordConfirm"
						:type="slotProps.isVisible ? 'text' : 'password'"
						class="input"
						autocapitalize="none"
						autocorrect="off"
						autocomplete="new-password"
						minlength="8"
						:disabled="Boolean(successMessage)"
						required
					/>
				</RevealPassword>
			</div>

			<div v-if="errorMessage" class="error">{{ errorMessage }}</div>
			<div v-if="successMessage" class="success">
				{{ successMessage }}
				<router-link class="inline-link" :to="{name: 'SignIn'}">sign in page</router-link>
				to sign in.
			</div>

			<button
				v-if="showResetForm"
				:disabled="inFlight || Boolean(successMessage)"
				type="submit"
				class="btn"
			>
				Set new password
			</button>
			<router-link class="link" :to="{name: 'SignIn'}">Back to sign in</router-link>
		</form>
	</div>
</template>

<script lang="ts">
import RevealPassword from "../RevealPassword.vue";
import {defineComponent, onMounted, ref} from "vue";
import {useRoute} from "vue-router";

export default defineComponent({
	name: "ResetPassword",
	components: {
		RevealPassword,
	},
	setup() {
		const route = useRoute();
		const inFlight = ref(false);
		const password = ref("");
		const passwordConfirm = ref("");
		const errorMessage = ref("");
		const successMessage = ref("");
		const showResetForm = ref(true);

		const onSubmit = async (event: Event) => {
			event.preventDefault();

			if (!password.value || !passwordConfirm.value) {
				return;
			}

			if (password.value !== passwordConfirm.value) {
				errorMessage.value = "Passwords do not match.";
				return;
			}

			if (password.value.length < 8) {
				errorMessage.value = "Password must be at least 8 characters.";
				return;
			}

			const token = String(route.params.token || "");

			if (!token) {
				errorMessage.value = "Invalid password reset token.";
				return;
			}

			inFlight.value = true;
			errorMessage.value = "";
			successMessage.value = "";

			try {
				const response = await fetch("/auth/reset/confirm", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						token,
						password: password.value,
					}),
				});

				if (!response.ok) {
					let message = "Could not reset password.";

					try {
						const data = (await response.json()) as {error?: string};
						if (data.error) {
							message = data.error;
						}
					} catch {
						// no-op
					}

					throw new Error(message);
				}

				successMessage.value = "Password updated. Return to the";
				password.value = "";
				passwordConfirm.value = "";
			} catch (error: any) {
				errorMessage.value = error.message || "Could not reset password.";
			} finally {
				inFlight.value = false;
			}
		};

		onMounted(async () => {
			const token = String(route.params.token || "");

			if (!token) {
				showResetForm.value = false;
				errorMessage.value = "Invalid password reset token.";
				return;
			}

			try {
				const response = await fetch(`/auth/reset/status/${encodeURIComponent(token)}`);

				if (response.ok) {
					return;
				}

				showResetForm.value = false;

				try {
					const data = (await response.json()) as {error?: string};
					errorMessage.value = data.error || "Invalid password reset token.";
				} catch {
					errorMessage.value = "Invalid password reset token.";
				}
			} catch {
				showResetForm.value = false;
				errorMessage.value = "Could not validate password reset token.";
			}
		});

		return {
			inFlight,
			password,
			passwordConfirm,
			errorMessage,
			successMessage,
			showResetForm,
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

.inline-link {
	margin-left: 4px;
}

.link {
	display: block;
	margin-top: 8px;
	text-align: center;
}
</style>
