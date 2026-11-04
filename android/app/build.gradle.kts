// 집 안 전용 메타데이터 전송 앱과 로컬 인증서 리소스를 빌드합니다.
plugins { id("com.android.application") }
// Windows의 한국어 경로에서 테스트 실행기가 실패하면 산출물만 영문 경로에 둡니다.
providers.gradleProperty("probeBuildDir").orNull?.let { layout.buildDirectory.set(file(it)) }
val lanCaFile = providers.gradleProperty("lanCaFile").orElse(rootProject.file("../data/집안사진전송인증서.crt").absolutePath)
val copyLanCa by tasks.registering(Copy::class) {
    from(lanCaFile) { rename { "lan_ca.crt" } }
    into(layout.buildDirectory.dir("generated/lan-ca/raw"))
    doFirst { check(file(lanCaFile.get()).isFile) { "집 안 공개 CA 인증서가 필요합니다. android/README.md를 확인하세요." } }
}
android {
    namespace = "org.butterflyarchive.photoprobe"
    compileSdk = 36
    defaultConfig {
        applicationId = "org.butterflyarchive.photoprobe"
        minSdk = 34
        targetSdk = 36
        versionCode = 2
        versionName = "0.2"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    sourceSets.getByName("main").res.srcDir(layout.buildDirectory.dir("generated/lan-ca").get().asFile)
}
tasks.named("preBuild") { dependsOn(copyLanCa) }
dependencies {
    implementation("androidx.exifinterface:exifinterface:1.4.2")
    implementation("androidx.activity:activity:1.12.4")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
}
