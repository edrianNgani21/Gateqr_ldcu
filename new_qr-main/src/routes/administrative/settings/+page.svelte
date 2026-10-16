<script lang="ts">
    import AdminSettingsView from '$lib/components/AdminSettingsView.svelte';

    let { data } = $props();
</script>

<AdminSettingsView
    {data}
    userRole="administrative"
    showSidebar={true}
    pageTitle="Settings"
    roleLabel="Administrative Department Head"
/>
