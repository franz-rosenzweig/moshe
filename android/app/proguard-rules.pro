# What the page calls through addJavascriptInterface must keep its name.
-keepclassmembers class xyz.tiresia.moshe.** {
    @android.webkit.JavascriptInterface <methods>;
}
