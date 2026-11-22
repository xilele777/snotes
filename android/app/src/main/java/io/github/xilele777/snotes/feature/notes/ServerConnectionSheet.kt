package io.github.xilele777.snotes.feature.notes

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.xilele777.snotes.core.ui.*
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ServerConnectionSheet(
    model: NotesViewModel,
    initialEditForm: Boolean = false,
    onDismiss: () -> Unit,
    onOpenFailures: () -> Unit,
) {
    val colors = MaterialTheme.snotesColors
    val sync by model.syncStatus.collectAsStateWithLifecycle()
    val pending by model.pending.collectAsStateWithLifecycle()
    val failures by model.syncFailures.collectAsStateWithLifecycle()
    val connectedOrigin by model.connectedOrigin.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()

    var editingForm by rememberSaveable(sync.connected, initialEditForm) {
        mutableStateOf(!sync.connected || initialEditForm)
    }
    var serverOrigin by rememberSaveable(connectedOrigin) { mutableStateOf(connectedOrigin.orEmpty()) }
    var serverToken by remember { mutableStateOf("") }
    var showToken by remember { mutableStateOf(false) }
    var checking by remember { mutableStateOf(false) }
    var connectionError by remember { mutableStateOf<String?>(null) }

    val statusDot = when {
        failures.isNotEmpty() -> colors.danger
        sync.running -> colors.accent
        sync.connected -> colors.success
        else -> colors.textDisabled
    }
    val statusBadgeBg = when {
        failures.isNotEmpty() -> colors.dangerBg
        sync.running -> colors.accentSoft
        sync.connected -> colors.successBg
        else -> colors.bgHover
    }
    val statusBadgeText = when {
        failures.isNotEmpty() -> colors.danger
        sync.running -> colors.accent
        sync.connected -> colors.success
        else -> colors.textSecondary
    }
    val statusLabel = when {
        sync.running -> "同步中"
        failures.isNotEmpty() -> "${failures.size} 项失败"
        sync.connected && pending > 0 -> "$pending 项待同步"
        sync.connected -> "已连接"
        else -> "未连接"
    }

    ModalBottomSheet(
        onDismissRequest = { if (!checking) onDismiss() },
        containerColor = colors.bgSurface,
        shape = RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp),
        dragHandle = { BottomSheetDefaults.DragHandle(color = colors.borderDefault) },
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text("云端同步", style = MaterialTheme.typography.titleLarge, color = colors.textPrimary)
                Surface(shape = RoundedCornerShape(16.dp), color = statusBadgeBg) {
                    Row(
                        Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Box(Modifier.size(6.dp).clip(CircleShape).background(statusDot))
                        Text(
                            statusLabel,
                            style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
                            color = statusBadgeText,
                        )
                    }
                }
            }

            if (sync.connected) {
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = colors.bgList,
                    border = BorderStroke(0.75.dp, colors.borderLight),
                ) {
                    Column(
                        Modifier.fillMaxWidth().padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Row(
                            Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            SnotesIcon(SnotesSymbol.Cloud, size = 19.dp, tint = colors.textSecondary)
                            Text(
                                connectedOrigin?.removePrefix("https://")?.removePrefix("http://")?.trimEnd('/') ?: "已连接服务端",
                                style = MaterialTheme.typography.titleMedium,
                                color = colors.textPrimary,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f),
                            )
                        }

                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Button(
                                onClick = model::synchronize,
                                enabled = !sync.running && !checking,
                                shape = RoundedCornerShape(10.dp),
                                modifier = Modifier.weight(1f).height(40.dp),
                            ) {
                                SnotesIcon(SnotesSymbol.Sync, size = 15.dp)
                                Spacer(Modifier.width(6.dp))
                                Text(if (sync.running) "同步中…" else "立即同步")
                            }
                            if (sync.running) {
                                OutlinedButton(
                                    onClick = model::stopSync,
                                    shape = RoundedCornerShape(10.dp),
                                    modifier = Modifier.height(40.dp),
                                ) { Text("停止") }
                            } else {
                                OutlinedButton(
                                    onClick = { editingForm = !editingForm; connectionError = null },
                                    shape = RoundedCornerShape(10.dp),
                                    border = BorderStroke(1.dp, colors.borderDefault),
                                    modifier = Modifier.height(40.dp),
                                ) { Text(if (editingForm) "收起" else "更改连接") }
                            }
                        }

                        if (failures.isNotEmpty()) {
                            HorizontalDivider(color = colors.divider)
                            Row(
                                Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween,
                            ) {
                                TextButton(onClick = { onDismiss(); onOpenFailures() }) {
                                    Text("查看失败项 (${failures.size})", color = colors.danger)
                                }
                                TextButton(onClick = model::retrySync, enabled = !sync.running) {
                                    Text("重试")
                                }
                            }
                        }
                    }
                }
            }

            AnimatedVisibility(
                visible = editingForm,
                enter = expandVertically(tween(SnotesMotion.NormalMs, easing = SnotesMotion.EaseOut)) + fadeIn(),
                exit = shrinkVertically(tween(SnotesMotion.FastMs)) + fadeOut(),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedTextField(
                        value = serverOrigin,
                        onValueChange = { serverOrigin = it.take(2048); connectionError = null },
                        label = { Text("服务端地址") },
                        placeholder = { Text("https://notes.example.com") },
                        singleLine = true,
                        enabled = !checking,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(10.dp),
                    )
                    OutlinedTextField(
                        value = serverToken,
                        onValueChange = { serverToken = it.take(8192); connectionError = null },
                        label = { Text("访问令牌") },
                        singleLine = true,
                        visualTransformation = if (showToken) VisualTransformation.None else PasswordVisualTransformation(),
                        trailingIcon = {
                            IconButton(onClick = { showToken = !showToken }) {
                                SnotesIcon(
                                    if (showToken) SnotesSymbol.EyeOff else SnotesSymbol.Eye,
                                    size = 18.dp,
                                    description = if (showToken) "隐藏令牌" else "显示令牌",
                                    tint = colors.textTertiary,
                                )
                            }
                        },
                        enabled = !checking,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(10.dp),
                    )
                    connectionError?.let {
                        Surface(shape = RoundedCornerShape(10.dp), color = colors.dangerBg) {
                            Row(
                                Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 9.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                SnotesIcon(SnotesSymbol.Alert, size = 16.dp, tint = colors.danger)
                                Text(it, color = colors.danger, style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                    Button(
                        onClick = {
                            checking = true
                            connectionError = null
                            scope.launch {
                                try {
                                    if (model.connect(serverOrigin, serverToken)) {
                                        serverToken = ""
                                        editingForm = false
                                        model.synchronize()
                                        onDismiss()
                                    } else {
                                        connectionError = model.message.value ?: "连接失败，请检查地址和令牌"
                                    }
                                } finally {
                                    checking = false
                                }
                            }
                        },
                        enabled = !checking && serverOrigin.isNotBlank() && serverToken.isNotBlank(),
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.fillMaxWidth().height(44.dp),
                    ) {
                        Text(if (checking) "连接中…" else if (sync.connected) "保存连接" else "连接")
                    }
                }
            }
        }
    }
}
