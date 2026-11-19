-keep class io.github.xilele777.snotes.benchmark.StartupBenchmark { *; }
-keepattributes RuntimeVisibleAnnotations,AnnotationDefault
# Optional compatibility APIs and source annotations in benchmark dependencies.
# These rules apply to the measurement APK only, never to the app.
-dontwarn android.hardware.fingerprint.FingerprintManager
-dontwarn android.hardware.fingerprint.FingerprintManager$AuthenticationCallback
-dontwarn android.hardware.fingerprint.FingerprintManager$AuthenticationResult
-dontwarn android.hardware.fingerprint.FingerprintManager$CryptoObject
-dontwarn com.google.errorprone.annotations.CanIgnoreReturnValue
-dontwarn com.google.errorprone.annotations.MustBeClosed
