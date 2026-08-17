#include <ApplicationServices/ApplicationServices.h>
#include <CoreFoundation/CoreFoundation.h>
#include <node_api.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

typedef void (*openhistory_collector_event_callback)(const char *, void *);

extern int32_t openhistory_collector_start(
    const char *data_directory,
    const char *configuration_json,
    openhistory_collector_event_callback callback,
    void *context
);
extern void openhistory_collector_stop(void);

static napi_threadsafe_function collector_events = NULL;

static napi_value boolean_value(napi_env env, bool value) {
    napi_value result;
    if (napi_get_boolean(env, value, &result) != napi_ok) return NULL;
    return result;
}

static napi_value undefined_value(napi_env env) {
    napi_value result;
    if (napi_get_undefined(env, &result) != napi_ok) return NULL;
    return result;
}

static char *copy_utf8_argument(napi_env env, napi_value value, const char *label) {
    napi_valuetype type;
    if (napi_typeof(env, value, &type) != napi_ok || type != napi_string) {
        napi_throw_type_error(env, NULL, label);
        return NULL;
    }
    size_t length = 0;
    if (napi_get_value_string_utf8(env, value, NULL, 0, &length) != napi_ok) return NULL;
    char *buffer = calloc(length + 1, sizeof(char));
    if (buffer == NULL) {
        napi_throw_error(env, NULL, "Unable to allocate native collector input");
        return NULL;
    }
    if (napi_get_value_string_utf8(env, value, buffer, length + 1, &length) != napi_ok) {
        free(buffer);
        return NULL;
    }
    return buffer;
}

static void deliver_collector_event(
    napi_env env,
    napi_value javascript_callback,
    void *context,
    void *data
) {
    (void)context;
    char *line = data;
    if (env != NULL && javascript_callback != NULL && line != NULL) {
        napi_value receiver;
        napi_value argument;
        napi_value ignored;
        if (napi_get_undefined(env, &receiver) == napi_ok &&
            napi_create_string_utf8(env, line, NAPI_AUTO_LENGTH, &argument) == napi_ok) {
            napi_call_function(env, receiver, javascript_callback, 1, &argument, &ignored);
        }
    }
    free(line);
}

static void receive_collector_event(const char *line, void *context) {
    (void)context;
    if (line == NULL || collector_events == NULL) return;
    char *copy = strdup(line);
    if (copy == NULL) return;
    napi_status status = napi_call_threadsafe_function(
        collector_events,
        copy,
        napi_tsfn_nonblocking
    );
    if (status != napi_ok) free(copy);
}

static void stop_embedded_collector(void) {
    openhistory_collector_stop();
    if (collector_events != NULL) {
        napi_release_threadsafe_function(collector_events, napi_tsfn_release);
        collector_events = NULL;
    }
}

static napi_value start_collector(napi_env env, napi_callback_info info) {
    size_t argument_count = 3;
    napi_value arguments[3];
    if (napi_get_cb_info(env, info, &argument_count, arguments, NULL, NULL) != napi_ok) {
        return NULL;
    }
    if (argument_count != 3) {
        napi_throw_type_error(env, NULL, "startCollector requires a data directory, configuration JSON, and event callback");
        return NULL;
    }

    napi_valuetype callback_type;
    if (napi_typeof(env, arguments[2], &callback_type) != napi_ok || callback_type != napi_function) {
        napi_throw_type_error(env, NULL, "startCollector event callback must be a function");
        return NULL;
    }

    char *data_directory = copy_utf8_argument(env, arguments[0], "startCollector data directory must be a string");
    if (data_directory == NULL) return NULL;
    char *configuration_json = copy_utf8_argument(env, arguments[1], "startCollector configuration must be JSON text");
    if (configuration_json == NULL) {
        free(data_directory);
        return NULL;
    }

    stop_embedded_collector();
    napi_value resource_name;
    napi_status status = napi_create_string_utf8(
        env,
        "OpenHistory collector events",
        NAPI_AUTO_LENGTH,
        &resource_name
    );
    if (status == napi_ok) {
        status = napi_create_threadsafe_function(
            env,
            arguments[2],
            NULL,
            resource_name,
            4096,
            1,
            NULL,
            NULL,
            NULL,
            deliver_collector_event,
            &collector_events
        );
    }
    if (status != napi_ok) {
        free(data_directory);
        free(configuration_json);
        napi_throw_error(env, NULL, "Unable to create the native collector event channel");
        return NULL;
    }

    int32_t result = openhistory_collector_start(
        data_directory,
        configuration_json,
        receive_collector_event,
        NULL
    );
    free(data_directory);
    free(configuration_json);
    if (result != 0) {
        stop_embedded_collector();
        napi_throw_error(env, NULL, "The native collector could not start");
        return NULL;
    }
    return boolean_value(env, true);
}

static napi_value stop_collector(napi_env env, napi_callback_info info) {
    (void)info;
    stop_embedded_collector();
    return undefined_value(env);
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
        { "startCollector", NULL, start_collector, NULL, NULL, NULL, napi_default, NULL },
        { "stopCollector", NULL, stop_collector, NULL, NULL, NULL, napi_default, NULL },
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
