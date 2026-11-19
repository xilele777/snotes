package io.github.xilele777.snotes.app

import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import io.github.xilele777.snotes.core.data.NotesRepository

/** Instrumentation access belongs to the debug component, never the release APK. */
@EntryPoint @InstallIn(SingletonComponent::class)
interface TestRepositoryAccess { fun repository(): NotesRepository }
