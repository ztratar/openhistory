#include <ApplicationServices/ApplicationServices.h>
#include <CoreFoundation/CoreFoundation.h>
#include <node_api.h>
#include <stdlib.h>
#include <unistd.h>

static napi_value boolean_value(napi_env env, bool value) {
    napi_value result;
    if (napi_get_boolean(env, value, &result) != napi_ok) return NULL;
    return result;
}

static napi_value is_trusted(napi_env env, napi_callback_info info) {
    (void)info;
    return boolean_value(env, AXIsProcessTrusted());
}

static napi_value request_trust(napi_env env, napi_callback_info info) {
    (void)info;
    const void *keys[] = { kAXTrustedCheckOptionPrompt };
    const void *values[] = { kCFBooleanTrue };
    CFDictionaryRef options = CFDictionaryCreate(
        kCFAllocatorDefault,
        keys,
        values,
        1,
        &kCFTypeDictionaryKeyCallBacks,
        &kCFTypeDictionaryValueCallBacks
    );
    Boolean trusted = options == NULL
        ? AXIsProcessTrusted()
        : AXIsProcessTrustedWithOptions(options);
    if (options != NULL) CFRelease(options);
    return boolean_value(env, trusted);
}

static napi_value process_identifier(napi_env env, napi_callback_info info) {
    (void)info;
    napi_value result;
    if (napi_create_int64(env, (int64_t)getpid(), &result) != napi_ok) return NULL;
    return result;
}

static napi_value can_read_focused_application(napi_env env, napi_callback_info info) {
    (void)info;
    AXUIElementRef system_wide = AXUIElementCreateSystemWide();
    CFTypeRef focused_application = NULL;
    AXError error = AXUIElementCopyAttributeValue(
        system_wide,
        kAXFocusedApplicationAttribute,
        &focused_application
    );
    if (focused_application != NULL) CFRelease(focused_application);
    CFRelease(system_wide);
    return boolean_value(env, error == kAXErrorSuccess);
}

static napi_value bundle_identifier(napi_env env, napi_callback_info info) {
    (void)info;
    CFBundleRef bundle = CFBundleGetMainBundle();
    CFStringRef identifier = bundle == NULL ? NULL : CFBundleGetIdentifier(bundle);
    if (identifier == NULL) {
        napi_value result;
        if (napi_get_null(env, &result) != napi_ok) return NULL;
        return result;
    }

    CFIndex length = CFStringGetLength(identifier);
    CFIndex capacity = CFStringGetMaximumSizeForEncoding(length, kCFStringEncodingUTF8) + 1;
    char *buffer = calloc((size_t)capacity, sizeof(char));
    if (buffer == NULL || !CFStringGetCString(identifier, buffer, capacity, kCFStringEncodingUTF8)) {
        free(buffer);
        napi_throw_error(env, NULL, "Unable to read the host bundle identifier");
        return NULL;
    }

    napi_value result;
    napi_status status = napi_create_string_utf8(env, buffer, NAPI_AUTO_LENGTH, &result);
    free(buffer);
    if (status != napi_ok) return NULL;
    return result;
}

NAPI_MODULE_INIT() {
    napi_property_descriptor properties[] = {
        { "isTrusted", NULL, is_trusted, NULL, NULL, NULL, napi_default, NULL },
        { "requestTrust", NULL, request_trust, NULL, NULL, NULL, napi_default, NULL },
        { "processIdentifier", NULL, process_identifier, NULL, NULL, NULL, napi_default, NULL },
        { "canReadFocusedApplication", NULL, can_read_focused_application, NULL, NULL, NULL, napi_default, NULL },
        { "bundleIdentifier", NULL, bundle_identifier, NULL, NULL, NULL, napi_default, NULL }
    };
    if (napi_define_properties(
        env,
        exports,
        sizeof(properties) / sizeof(properties[0]),
        properties
    ) != napi_ok) {
        return NULL;
    }
    return exports;
}
