// @ts-nocheck
import { Save } from "lucide-react"
import { getWorkflowNodeDefinitionForNode } from "@solzero/shared"
import { PageHeader } from "@/components/page-header"
import { UnsavedChangesModal } from "@/components/unsaved-changes-modal"
import { SidebarLayout } from "@/components/sidebar-layout"
import { copyToClipboard } from "@/lib/format"
import { WorkflowIndexLanding } from "./index-page"
import { Button } from "@cloudflare/kumo/components/button"
import {
  WorkflowBuilderSidebarCloser,
  WorkflowDetailLoadErrorState,
  WorkflowDetailLoadingState,
  WorkflowVersionToolbar,
  WorkflowViewTabs,
} from "./detail-chrome"
import { WorkflowSlackAppSetupModal } from "./slack-setup"
import { WorkflowSaveDialog, WorkflowValidationErrorsDialog } from "./save-dialog"
import { WorkflowCreationDialog, WorkflowOverview } from "./overview"
import { WorkflowBuilder } from "./builder"
import { WorkflowAiEditDialog } from "./ai-dialog"
import {
  DeleteConnectionConfirmationModal,
  DeleteNodeConfirmationModal,
  DeleteRunConfirmationModal,
  DeleteWorkflowConfirmationModal,
  OverwriteManualInputConnectionModal,
  ReplaceInputConnectionModal,
  SlackTestModal,
  WebhookTestModal,
} from "./modals"
import { getLatestSlackTestTrigger, getLatestWebhookTestPayload } from "./run-utils"

export function WorkflowsPageFrame(input: any) {
  const {
    activeTab,
    addNode,
    buildWorkflowWithLlm,
    builderNodes,
    builderPrompt,
    builderRunning,
    clearCanvasNodeSelection,
    clearWorkflowConfigFocusTarget,
    closeWorkflowSaveDialog,
    confirmConnectionReplacement,
    confirmManualInputOverwrite,
    confirmWorkflowSave,
    connectionPendingDeletion,
    connectionPendingManualOverwrite,
    connectionPendingReplacement,
    createDraftFromTemplate,
    creationDialogOpen,
    creationMode,
    currentManifestHasSlackTriggers,
    deleteEdge,
    deleteNode,
    deleteWorkflow,
    deleteWorkflowRun,
    deletingRunId,
    deletingWorkflowId,
    detailsCollapsed,
    edges,
    events,
    exportSelectedWorkflow,
    handleEdgesChange,
    importWarnings,
    importWorkflowFile,
    loadWorkflowDraft,
    loading,
    modelOptions,
    providerCatalogLoading,
    navigationBlocker,
    nodePendingDeletion,
    nodePickerCollapsed,
    nodes,
    onConnect,
    onEdgesChange,
    onNodesChange,
    openNodeCatalog,
    openWorkflowConfigError,
    openWorkflowCreationMode,
    openWorkflowAiDialog,
    openWorkflowSaveDialog,
    removeSelectedNodeInputHandle,
    renameSelectedNode,
    renameSelectedNodeInputHandle,
    revertWorkflowSaveDialogChange,
    runDetailsOpen,
    runErrorsLast24Hours,
    runPendingDeletion,
    runTableLoading,
    runTableState,
    runTableTotal,
    runTotal,
    runTrigger,
    runnableTriggerNode,
    running,
    runs,
    saveBeforeNavigation,
    saveWorkflowTitle,
    saving,
    savingWorkflowTitle,
    savingBeforeNavigation,
    selectCanvasEdge,
    selectCanvasNode,
    selectRun,
    selectWorkflow,
    selectedEdge,
    selectedHeaderDraftRows,
    selectedNode,
    selectedRunId,
    selectedWorkflow,
    selectedWorkflowId,
    selectedWorkflowLoadError,
    selectedWorkflowReady,
    setActiveTab,
    setBuilderPrompt,
    setConnectionPendingManualOverwrite,
    setConnectionPendingReplacement,
    setCreationDialogOpen,
    setDetailsCollapsed,
    setEdgePendingDeletionId,
    setNodePendingDeletion,
    setNodePickerCollapsed,
    setRunDetailsOpen,
    setRunPendingDeletion,
    setRunTableState,
    setSlackAppSetupOpen,
    setSlackTestNode,
    setWebhookTestNode,
    setWorkflowAiChatOpen,
    setWorkflowDetailReloadNonce,
    setWorkflowEnabled,
    setWorkflowListState,
    setWorkflowName,
    setWorkflowTitleDraft,
    setWorkflowPendingDeletion,
    setWorkflowValidationDialogOpen,
    showWorkflowDetailLoader,
    showWorkflowIndexView,
    slackAppSetupOpen,
    slackTestNode,
    startWorkflowAiTurn,
    submitApproval,
    submittingApprovalNodeId,
    testTriggerNode,
    updateSelectedNode,
    updateWorkflowHeaderDraftRows,
    updatingWorkflowStatus,
    webhookTestNode,
    webhookUrl,
    workflowAiChatOpen,
    workflowAiContextRuns,
    workflowAiSending,
    workflowAiSessionId,
    toggleWorkflowAiContextRun,
    toggleVisibleWorkflowAiContextRuns,
    workflowConfigErrors,
    workflowConfigFocusTarget,
    workflowDisabled,
    workflowHasSaveDiff,
    workflowListState,
    workflowName,
    workflowTitleDraft,
    workflowTitleDirty,
    workflowTitleInvalid,
    workflowPendingDeletion,
    workflowSaveDialog,
    workflowTotal,
    workflowValidationDialogOpen,
    workflows,
  } = input
  const workflowHeaderTitleValue = selectedWorkflowId ? workflowTitleDraft : workflowName
  const workflowHeaderTitleCanSave =
    workflowTitleDirty && !workflowTitleInvalid && !savingWorkflowTitle

  return (
    <SidebarLayout>
      <div className="flex h-screen min-w-0 flex-col bg-kumo-canvas">
        <WorkflowBuilderSidebarCloser
          activeTab={activeTab}
          showWorkflowIndexView={showWorkflowIndexView}
        />
        <PageHeader
          actions={
            showWorkflowIndexView ? null : (
              <WorkflowViewTabs activeTab={activeTab} onChange={setActiveTab} />
            )
          }
        >
          {showWorkflowIndexView ? (
            <h1 className="min-w-0 truncate text-lg font-medium text-kumo-default">Workflows</h1>
          ) : !selectedWorkflowReady ? (
            <h1 className="min-w-0 truncate text-lg font-medium text-kumo-default">
              {selectedWorkflow?.name ?? "Loading workflow"}
            </h1>
          ) : (
            <form
              className="-ml-2 flex min-w-0 items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                if (workflowHeaderTitleCanSave) {
                  void saveWorkflowTitle()
                }
              }}
            >
              <input
                value={workflowHeaderTitleValue}
                onChange={(event) => {
                  if (selectedWorkflowId) {
                    setWorkflowTitleDraft(event.target.value)
                    return
                  }
                  setWorkflowName(event.target.value)
                }}
                className={`min-w-0 rounded-lg bg-kumo-tint px-2 py-1 text-lg font-medium text-kumo-default outline-none ring-1 transition-[background-color,box-shadow] focus:bg-kumo-elevated ${
                  workflowTitleInvalid
                    ? "ring-kumo-danger focus:ring-kumo-danger"
                    : "ring-transparent focus:ring-kumo-focus"
                }`}
                aria-invalid={workflowTitleInvalid || undefined}
                aria-label="Workflow name"
              />
              {workflowTitleDirty ? (
                <Button
                  type="submit"
                  disabled={!workflowHeaderTitleCanSave}
                  size="sm"
                  variant="secondary"
                  title="Save workflow name"
                  aria-label="Save workflow name"
                  loading={savingWorkflowTitle}
                  icon={<Save className="h-4 w-4" aria-hidden />}
                />
              ) : null}
            </form>
          )}
        </PageHeader>

        {showWorkflowIndexView ? null : (
          <WorkflowVersionToolbar
            workflow={selectedWorkflow}
            onExport={exportSelectedWorkflow}
            onRequestDeleteWorkflow={setWorkflowPendingDeletion}
            onSetWorkflowEnabled={(workflow, enabled) => void setWorkflowEnabled(workflow, enabled)}
            updatingWorkflowStatus={updatingWorkflowStatus}
            slackAppSetupAvailable={selectedWorkflowReady && currentManifestHasSlackTriggers}
            slackAppSetupDisabled={
              !selectedWorkflowId || !selectedWorkflowReady || workflowHasSaveDiff
            }
            slackAppSetupDisabledReason={
              !selectedWorkflowId
                ? "Save the workflow before configuring its Slack app"
                : !selectedWorkflowReady
                  ? "Wait for the workflow to finish loading"
                  : workflowHasSaveDiff
                    ? "Save workflow changes before configuring its Slack app"
                    : undefined
            }
            onOpenSlackAppSetup={() => setSlackAppSetupOpen(true)}
            triggerNode={selectedWorkflowReady ? runnableTriggerNode : null}
            triggerRunDisabled={
              running || !selectedWorkflowId || !selectedWorkflowReady || workflowDisabled
            }
            triggerRunning={running}
            onRunTrigger={testTriggerNode}
            editWithAiDisabled={!selectedWorkflowReady}
            onEditWithAi={openWorkflowAiDialog}
          />
        )}

        {importWarnings.length > 0 ? (
          <div className="border-b border-kumo-warning/20 bg-kumo-warning-tint/10 px-4 py-2 text-sm text-kumo-warning">
            {importWarnings.join(" ")}
          </div>
        ) : null}

        {showWorkflowIndexView ? (
          <WorkflowIndexLanding
            workflows={workflows}
            total={workflowTotal}
            state={workflowListState}
            loading={loading}
            deletingWorkflowId={deletingWorkflowId}
            onStateChange={(patch) => setWorkflowListState((current) => ({ ...current, ...patch }))}
            onOpenCreationMode={openWorkflowCreationMode}
            onSelectWorkflow={selectWorkflow}
            onRequestDeleteWorkflow={setWorkflowPendingDeletion}
          />
        ) : showWorkflowDetailLoader ? (
          <WorkflowDetailLoadingState />
        ) : selectedWorkflowLoadError ? (
          <WorkflowDetailLoadErrorState
            message={selectedWorkflowLoadError}
            onRetry={() => setWorkflowDetailReloadNonce((current) => current + 1)}
          />
        ) : activeTab === "overview" ? (
          <WorkflowOverview
            workflow={selectedWorkflow}
            runs={runs}
            runTableTotal={runTableTotal}
            runTotal={runTotal}
            runErrorsLast24Hours={runErrorsLast24Hours}
            runTableState={runTableState}
            runTableLoading={runTableLoading}
            events={events}
            selectedRunId={selectedRunId}
            runDetailsOpen={runDetailsOpen}
            onRunTableStateChange={(patch) =>
              setRunTableState((current) => ({ ...current, ...patch }))
            }
            onSelectRun={selectRun}
            onCloseRunDetails={() => setRunDetailsOpen(false)}
            onSubmitApproval={submitApproval}
            submittingApprovalNodeId={submittingApprovalNodeId}
            onRequestDeleteRun={setRunPendingDeletion}
            deletingRunId={deletingRunId}
          />
        ) : (
          <WorkflowBuilder
            workflowId={selectedWorkflowId}
            runId={selectedRunId}
            nodes={builderNodes}
            edges={edges}
            selectedNode={selectedNode?.data.node ?? null}
            selectedNodeDefinition={
              selectedNode ? getWorkflowNodeDefinitionForNode(selectedNode.data.node) : null
            }
            selectedEdge={selectedEdge}
            webhookUrl={webhookUrl}
            modelOptions={modelOptions}
            providerCatalogLoading={providerCatalogLoading}
            nodePickerCollapsed={nodePickerCollapsed}
            detailsCollapsed={detailsCollapsed}
            configFocusTarget={workflowConfigFocusTarget}
            selectedHeaderDraftRows={selectedHeaderDraftRows}
            nodeIds={nodes.map((node) => node.id)}
            showSaveButton={workflowHasSaveDiff}
            saving={saving}
            onAddNode={addNode}
            onSave={openWorkflowSaveDialog}
            onSetNodePickerCollapsed={setNodePickerCollapsed}
            onSetDetailsCollapsed={setDetailsCollapsed}
            onNodesChange={onNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={onConnect}
            onNodeClick={selectCanvasNode}
            onEdgeClick={selectCanvasEdge}
            onPaneClick={clearCanvasNodeSelection}
            onOpenNodeCatalog={openNodeCatalog}
            onCopyWebhook={() => {
              if (webhookUrl) {
                void copyToClipboard(webhookUrl)
              }
            }}
            onHeaderDraftRowsChange={updateWorkflowHeaderDraftRows}
            onChangeSelectedNode={updateSelectedNode}
            onConfigFocusComplete={clearWorkflowConfigFocusTarget}
            onRenameSelectedNode={renameSelectedNode}
            onRenameSelectedInputHandle={renameSelectedNodeInputHandle}
            onRemoveSelectedInputHandle={removeSelectedNodeInputHandle}
            onRequestDeleteEdge={setEdgePendingDeletionId}
            onRequestDeleteNode={setNodePendingDeletion}
          />
        )}
        <WorkflowAiEditDialog
          open={workflowAiChatOpen}
          sessionId={workflowAiSessionId}
          sending={workflowAiSending}
          runs={runs}
          runTableTotal={runTableTotal}
          runTableState={runTableState}
          runTableLoading={runTableLoading}
          selectedRuns={workflowAiContextRuns}
          onClose={() => setWorkflowAiChatOpen(false)}
          onRunTableStateChange={(patch) =>
            setRunTableState((current) => ({ ...current, ...patch }))
          }
          onToggleRun={toggleWorkflowAiContextRun}
          onToggleVisibleRuns={toggleVisibleWorkflowAiContextRuns}
          onSend={(prompt) =>
            startWorkflowAiTurn({
              prompt,
              mode: "edit",
              runs: Array.from(workflowAiContextRuns.values()),
            })
          }
          onDraftReady={(draft) =>
            loadWorkflowDraft(draft.manifest, draft.validation?.warnings ?? [])
          }
        />
        {webhookTestNode ? (
          <WebhookTestModal
            node={webhookTestNode}
            running={running}
            recentPayload={getLatestWebhookTestPayload(runs, webhookTestNode.id)}
            onClose={() => setWebhookTestNode(null)}
            onRun={async (payload) => {
              await runTrigger(
                {
                  kind: "webhook",
                  nodeId: webhookTestNode.id,
                  payload,
                },
                { throwOnError: true },
              )
              setWebhookTestNode(null)
            }}
          />
        ) : null}
        {slackTestNode ? (
          <SlackTestModal
            node={slackTestNode}
            running={running}
            recentTrigger={getLatestSlackTestTrigger(runs, slackTestNode.id)}
            onClose={() => setSlackTestNode(null)}
            onRun={async (trigger) => {
              await runTrigger(trigger, { throwOnError: true })
              setSlackTestNode(null)
            }}
          />
        ) : null}
        {nodePendingDeletion ? (
          <DeleteNodeConfirmationModal
            node={nodePendingDeletion}
            onCancel={() => setNodePendingDeletion(null)}
            onConfirm={() => deleteNode(nodePendingDeletion.id)}
          />
        ) : null}
        {connectionPendingDeletion ? (
          <DeleteConnectionConfirmationModal
            connection={connectionPendingDeletion}
            onCancel={() => setEdgePendingDeletionId(null)}
            onConfirm={() => deleteEdge(connectionPendingDeletion.edge.id)}
          />
        ) : null}
        {connectionPendingReplacement ? (
          <ReplaceInputConnectionModal
            replacement={connectionPendingReplacement}
            nodes={nodes.map((node) => node.data.node)}
            onCancel={() => setConnectionPendingReplacement(null)}
            onConfirm={confirmConnectionReplacement}
          />
        ) : null}
        {connectionPendingManualOverwrite ? (
          <OverwriteManualInputConnectionModal
            overwrite={connectionPendingManualOverwrite}
            nodes={nodes.map((node) => node.data.node)}
            onCancel={() => setConnectionPendingManualOverwrite(null)}
            onConfirm={confirmManualInputOverwrite}
          />
        ) : null}
        {workflowPendingDeletion ? (
          <DeleteWorkflowConfirmationModal
            workflow={workflowPendingDeletion}
            deleting={deletingWorkflowId === workflowPendingDeletion.id}
            onCancel={() => setWorkflowPendingDeletion(null)}
            onConfirm={() => void deleteWorkflow(workflowPendingDeletion)}
          />
        ) : null}
        {runPendingDeletion ? (
          <DeleteRunConfirmationModal
            run={runPendingDeletion}
            deleting={deletingRunId === runPendingDeletion.id}
            onCancel={() => setRunPendingDeletion(null)}
            onConfirm={() => void deleteWorkflowRun(runPendingDeletion)}
          />
        ) : null}
        {navigationBlocker.status === "blocked" ? (
          <UnsavedChangesModal
            saving={savingBeforeNavigation || saving}
            description="This workflow has unsaved changes. Save before leaving, or continue without saving."
            onSave={() => void saveBeforeNavigation()}
            onLeave={navigationBlocker.proceed}
            onCancel={navigationBlocker.reset}
          />
        ) : null}
        {workflowValidationDialogOpen && workflowConfigErrors.length > 0 ? (
          <WorkflowValidationErrorsDialog
            errors={workflowConfigErrors}
            onClose={() => setWorkflowValidationDialogOpen(false)}
            onOpenError={openWorkflowConfigError}
          />
        ) : null}
        {slackAppSetupOpen && selectedWorkflowId ? (
          <WorkflowSlackAppSetupModal
            workflowId={selectedWorkflowId}
            workflowName={selectedWorkflow?.name ?? workflowName}
            workflowStatus={selectedWorkflow?.status ?? "active"}
            onClose={() => setSlackAppSetupOpen(false)}
          />
        ) : null}
        {workflowSaveDialog ? (
          <WorkflowSaveDialog
            state={workflowSaveDialog}
            onCancel={closeWorkflowSaveDialog}
            onConfirm={() => void confirmWorkflowSave()}
            onRevertChange={revertWorkflowSaveDialogChange}
          />
        ) : null}
        <WorkflowCreationDialog
          open={creationDialogOpen}
          mode={creationMode}
          builderPrompt={builderPrompt}
          builderRunning={builderRunning}
          onClose={() => setCreationDialogOpen(false)}
          onTemplateSelect={createDraftFromTemplate}
          onImportFile={importWorkflowFile}
          onBuilderPromptChange={setBuilderPrompt}
          onBuildWithLlm={buildWorkflowWithLlm}
        />
      </div>
    </SidebarLayout>
  )
}
