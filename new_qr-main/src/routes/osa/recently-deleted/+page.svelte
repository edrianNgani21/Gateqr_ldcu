<script lang="ts">
    import AppShell from '$lib/components/AppShell.svelte';
    import NavBar from '$lib/components/NavBar.svelte';
    import RecentlyDeletedPanel from '$lib/components/RecentlyDeletedPanel.svelte';

    let { data } = $props();
</script>

<svelte:head>
    <title>Recently Deleted - GateQR</title>
</svelte:head>

<AppShell userEmail={data.userEmail} showSidebar={true}>
    <NavBar title="Recently Deleted" />

    <div class="recently-deleted-container">
        <RecentlyDeletedPanel userEmail={data.userEmail} />
    </div>
</AppShell>

<style>
    .recently-deleted-container {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
    }
</style>
