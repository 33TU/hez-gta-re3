#pragma once
#define RE3_JOIN_INNER(a,b) a##b
#define RE3_JOIN(a,b) RE3_JOIN_INNER(a,b)
#define static_assert(test, message) typedef char RE3_JOIN(re3_static_assert_,__LINE__)[(test) ? 1 : -1]
