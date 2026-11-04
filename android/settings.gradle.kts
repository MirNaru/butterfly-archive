// PC 프로젝트와 독립적인 Android GPS 시험 앱의 저장소 설정입니다.
pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories { google(); mavenCentral() }
}
rootProject.name = "ButterflyPhotoProbe"
include(":app")
