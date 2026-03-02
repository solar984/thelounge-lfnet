<template>
	<div id="register" class="window" role="tabpanel" aria-label="Register">
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

			<label for="register-email">Email</label>
			<input
				id="register-email"
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

			<div class="password-container">
				<label for="register-password">Password</label>
				<RevealPassword v-slot:default="slotProps">
					<input
						id="register-password"
						v-model="password"
						:type="slotProps.isVisible ? 'text' : 'password'"
						class="input"
						autocapitalize="none"
						autocorrect="off"
						autocomplete="new-password"
						minlength="8"
						required
					/>
				</RevealPassword>
			</div>

			<p class="help-text">
				We will send an activation link to your email. Use that link to finish creating your
				account.
			</p>

			<div v-if="errorMessage" class="error">{{ errorMessage }}</div>
			<div v-else-if="successMessage" class="success">{{ successMessage }}</div>

			<button :disabled="inFlight" type="submit" class="btn">Register</button>

			<router-link class="link" :to="{name: 'SignIn'}">Back to sign in</router-link>
		</form>
	</div>
</template>

<script lang="ts">
import RevealPassword from "../RevealPassword.vue";
import {defineComponent, ref} from "vue";
import {withServerBasePath} from "../../js/server-path";

export default defineComponent({
	name: "Register",
	components: {
		RevealPassword,
	},
	setup() {
		const inFlight = ref(false);
		const email = ref("");
		const password = ref("");
		const errorMessage = ref("");
		const successMessage = ref("");

		const onSubmit = async (event: Event) => {
			event.preventDefault();

			if (!email.value || !password.value) {
				return;
			}

			inFlight.value = true;
			errorMessage.value = "";
			successMessage.value = "";

				try {
					const response = await fetch(withServerBasePath("/auth/register"), {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
						},
					body: JSON.stringify({
						email: email.value,
						password: password.value,
					}),
				});

				if (!response.ok) {
					let message = "Registration failed.";

					try {
						const data = (await response.json()) as {error?: string};

						if (typeof data.error === "string" && data.error.length > 0) {
							message = data.error;
						}
					} catch {
						// no-op
					}

					throw new Error(message);
				}

				successMessage.value =
					"Check your email for an activation link. You can sign in after activation.";
				password.value = "";
			} catch (error: any) {
				errorMessage.value = error.message || "Registration failed.";
			} finally {
				inFlight.value = false;
			}
		};

		return {
			inFlight,
			email,
			password,
			errorMessage,
			successMessage,
			onSubmit,
		};
	},
});
</script>

<style scoped>
.help-text {
	font-size: 13px;
	color: var(--body-color-muted);
	margin: 0;
}

.success {
	color: var(--link-color);
}

.link {
	display: block;
	margin-top: 6px;
	text-align: center;
}
</style>
