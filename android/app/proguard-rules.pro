# Add narrowly scoped rules as features require them; never keep the entire app.
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod
-keepclassmembers class * {
    @kotlinx.serialization.Serializable *;
}
-keep,allowobfuscation,allowshrinking interface io.github.xilele777.snotes.core.network.SyncService { *; }
