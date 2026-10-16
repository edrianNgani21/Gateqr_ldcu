<script lang="ts">
    import AdminSettingsView from '$lib/components/AdminSettingsView.svelte';

    let { data } = $props();
</script>

<AdminSettingsView
    {data}
    userRole="security"
    showSidebar={true}
    pageTitle="Settings"
    roleLabel="Security Administrator"
/>
