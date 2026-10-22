<script>
  import { signIn } from '../lib/state.svelte.js';
  let password = $state('');
  let error = $state('');
  let busy = $state(false);
  let unset = $state(false);
  fetch('/api/auth').then((r) => r.json()).then((a) => { unset = a.passwordSet === false; }).catch(() => {});
  async function go(e) {
    e.preventDefault();
    busy = true;
    error = '';
    try { await signIn(password); } catch (err) { error = err.message; } finally { busy = false; }
  }
</script>

<form class="login" onsubmit={go}>
  <div class="mark">מ</div>
  <h1>Moshe</h1>
  {#if unset}
    <p class="note">No password is set on the server yet, so it can’t be opened from here. On the server, run<br /><code>docker exec -it moshe node server/src/cli.js set-password</code></p>
  {/if}
  <!-- svelte-ignore a11y_autofocus -->
  <input class="field" type="password" placeholder="Password" bind:value={password} autofocus autocomplete="current-password" />
  <button class="btn primary" disabled={busy || !password}>Sign In</button>
  {#if error}<p class="err">{error}</p>{/if}
</form>

<style>
  .login { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; background: var(--sidebar-bg); }
  .mark { width: 64px; height: 64px; border-radius: 16px; background: var(--accent); color: var(--on-accent); font-size: 38px; display: flex; align-items: center; justify-content: center; font-family: "Frank Ruehl CLM", "Times New Roman", serif; }
  h1 { margin: 0 0 8px; font-size: 22px; }
  .field { width: 240px; height: 32px; font-size: 14px; }
  .btn { height: 30px; width: 240px; }
  .err { color: var(--danger); margin: 0; }
  .note { max-width: 420px; text-align: center; line-height: 1.5; color: var(--muted); }
  .note code { user-select: all; -webkit-user-select: all; color: var(--text); }
</style>
